import "./RequestForm.scss"
import { useState } from "react"

const fields = [
    { name: "first_name", type: "text", placeholder: "Имя" },
    { name: "last_name", type: "text", placeholder: "Фамилия" },
    { name: "phone", type: "tel", placeholder: "Телефон" },
    { name: "email", type: "email", placeholder: "Email" },
]

const emptyForm = { first_name: "", last_name: "", phone: "", email: "" }

export default function RequestForm(){

    const [form, setForm] = useState(emptyForm)
    const [status, setStatus] = useState({ type: "", text: "" })
    const [loading, setLoading] = useState(false)

    const handleChange = (event) => {
        setForm({ ...form, [event.target.name]: event.target.value })
    }

    const handleSubmit = async (event) => {
        event.preventDefault()
        setLoading(true)
        setStatus({ type: "", text: "" })

        try {
            const response = await fetch("/api/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            })
            const result = await response.json()

            if (response.ok) {
                setStatus({ type: "ok", text: "Заявка №" + result.id + " отправлена!" })
                setForm(emptyForm)
            } else {
                setStatus({ type: "error", text: result.error || "Ошибка отправки" })
            }
        } catch (err) {
            setStatus({ type: "error", text: "Нет связи с сервером" })
        }

        setLoading(false)
    }

    return(
        <>
            <section className="request" id="request">
                <form className="form" onSubmit={handleSubmit}>
                    <div className="text_container">
                        <h1>Оставить заявку</h1>
                        <p>Заполните форму, и мы свяжемся с вами</p>
                    </div>
                    <div className="fields">
                        {fields.map((field) => (
                            <input
                                key={field.name}
                                name={field.name}
                                type={field.type}
                                placeholder={field.placeholder}
                                value={form[field.name]}
                                onChange={handleChange}
                                required
                            />
                        ))}
                    </div>
                    <button type="submit" className="button_red" disabled={loading}>
                        {loading ? "Отправка..." : "Отправить"}
                    </button>
                    <p className={"status " + status.type}>{status.text}</p>
                </form>
            </section>
        </>
    )
}
