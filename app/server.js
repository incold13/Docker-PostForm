import express from "express"
import pg from "pg"
import { DatabaseSync } from "node:sqlite"
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

/* ---------- 1. ВРЕМЕННАЯ БАЗА №1 (SQLite, лежит в контейнере app) ---------- */
const sqlitePath = process.env.SQLITE_PATH || "./data/temp.db"
mkdirSync(dirname(sqlitePath), { recursive: true })
const tempDb = new DatabaseSync(sqlitePath)
tempDb.exec(`
    CREATE TABLE IF NOT EXISTS temp_requests (
        id          TEXT PRIMARY KEY,
        first_name  TEXT NOT NULL,
        last_name   TEXT NOT NULL,
        phone       TEXT NOT NULL,
        email       TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
`)
const insertTemp = tempDb.prepare(
    "INSERT INTO temp_requests (id, first_name, last_name, phone, email) VALUES (?, ?, ?, ?, ?)"
)
const selectPending = tempDb.prepare(
    "SELECT * FROM temp_requests WHERE status = 'pending' ORDER BY created_at LIMIT 50"
)
const markSent = tempDb.prepare("UPDATE temp_requests SET status = 'sent' WHERE id = ?")

/* ---------- 2. Подключение к PostgreSQL (контейнер db) ---------- */
const pool = new pg.Pool({
    host: process.env.DB_HOST || "db",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_NAME || "requests_db",
})
pool.on("error", (err) => console.error("pg pool:", err.message))

/* ---------- 2.1 Схема PostgreSQL: создаётся/дополняется автоматически при старте ---------- */
/* Нужна, потому что init.sql выполняется только на пустом томе и не трогает старую базу */
const schemaSql = `
    CREATE TABLE IF NOT EXISTS requests (
        id          SERIAL PRIMARY KEY,
        first_name  VARCHAR(100) NOT NULL,
        last_name   VARCHAR(100) NOT NULL,
        phone       VARCHAR(30)  NOT NULL,
        email       VARCHAR(255) NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS source_id TEXT;
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    CREATE UNIQUE INDEX IF NOT EXISTS requests_source_id_key ON requests (source_id);

    CREATE TABLE IF NOT EXISTS staging_requests (
        id          SERIAL PRIMARY KEY,
        source_id   TEXT         NOT NULL UNIQUE,
        first_name  VARCHAR(100) NOT NULL,
        last_name   VARCHAR(100) NOT NULL,
        phone       VARCHAR(30)  NOT NULL,
        email       VARCHAR(255) NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL,
        processed   BOOLEAN      NOT NULL DEFAULT FALSE
    );

    CREATE OR REPLACE FUNCTION merge_staging_to_main() RETURNS integer AS $$
    DECLARE
        moved integer;
    BEGIN
        INSERT INTO requests (source_id, first_name, last_name, phone, email, created_at)
        SELECT source_id, first_name, last_name, phone, email, created_at
        FROM staging_requests
        WHERE NOT processed
        ON CONFLICT (source_id) DO NOTHING;
        GET DIAGNOSTICS moved = ROW_COUNT;

        UPDATE staging_requests SET processed = TRUE WHERE NOT processed;
        RETURN moved;
    END;
    $$ LANGUAGE plpgsql;
`

async function ensureSchema() {
    for (;;) {
        try {
            await pool.query(schemaSql)
            console.log("PostgreSQL: таблицы staging_requests и requests готовы")
            return
        } catch (err) {
            console.error("PostgreSQL: жду базу...", err.message)
            await new Promise((resolve) => setTimeout(resolve, 3000))
        }
    }
}

/* ---------- 3. Перенос: temp SQLite -> staging (temp №2) -> основная таблица ---------- */
let syncing = false
async function syncOnce() {
    if (syncing) return
    syncing = true
    try {
        const rows = selectPending.all()
        const client = await pool.connect()
        try {
            for (const r of rows) {
                await client.query(
                    `INSERT INTO staging_requests (source_id, first_name, last_name, phone, email, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (source_id) DO NOTHING`,
                    [r.id, r.first_name, r.last_name, r.phone, r.email, r.created_at + "Z"]
                )
                markSent.run(r.id)
            }
            const merged = await client.query("SELECT merge_staging_to_main() AS moved")
            if (merged.rows[0].moved > 0) {
                console.log("в основную базу перенесено заявок:", merged.rows[0].moved)
            }
        } finally {
            client.release()
        }
    } catch (err) {
        console.error("sync: основная база недоступна, повторю позже:", err.message)
    } finally {
        syncing = false
    }
}
ensureSchema().then(() => {
    syncOnce()
    setInterval(syncOnce, 5000)
})

/* ---------- 4. API и сайт ---------- */
const app = express()
app.use(express.json())

const phoneRe = /^\+?[0-9\s\-()]{7,20}$/
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

app.post("/api/requests", (req, res) => {
    const { first_name, last_name, phone, email } = req.body || {}
    const f = String(first_name || "").trim()
    const l = String(last_name || "").trim()
    const p = String(phone || "").trim()
    const e = String(email || "").trim()

    if (!f || !l || !p || !e) {
        return res.status(400).json({ error: "Заполните все поля" })
    }
    if (!phoneRe.test(p)) {
        return res.status(400).json({ error: "Некорректный телефон" })
    }
    if (!emailRe.test(e)) {
        return res.status(400).json({ error: "Некорректный email" })
    }

    try {
        const id = randomUUID()
        insertTemp.run(id, f, l, p, e)
        res.status(201).json({ ok: true, id: id.slice(0, 8) })
        syncOnce()
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Ошибка сервера, попробуйте позже" })
    }
})

app.use(express.static("dist"))
app.get("*", (req, res) => res.sendFile("index.html", { root: "dist" }))

app.listen(3000, () => console.log("app: http://localhost:3000"))
