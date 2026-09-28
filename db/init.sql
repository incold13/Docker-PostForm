-- ВРЕМЕННАЯ БАЗА №2: сюда заявки приходят из временной базы контейнера app
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

-- ОСНОВНАЯ БАЗА: итоговая таблица
CREATE TABLE IF NOT EXISTS requests (
    id          SERIAL PRIMARY KEY,
    source_id   TEXT         NOT NULL UNIQUE,
    first_name  VARCHAR(100) NOT NULL,
    last_name   VARCHAR(100) NOT NULL,
    phone       VARCHAR(30)  NOT NULL,
    email       VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL,
    saved_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Переносит новые строки из staging в основную таблицу и помечает их обработанными
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
