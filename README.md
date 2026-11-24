# Estudio Deep Link — Extensión de Chrome (Manifest V3)

Extensión personal para capturar **deep links**, **minutos exactos de video**, **citas subrayadas** y **recortes de pantalla** desde cualquier página (YouTube, Coursera, Gemini, NotebookLM, Claude, ChatGPT, documentación y tus propias apps web) y organizarlos por **proyectos y categorías**, con exportación JSON limpia pensada para integrarse después con **Life OS**.

---

## Instalación en Google Chrome (modo desarrollador)

1. Abre `chrome://extensions` en Google Chrome.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** (*Load unpacked*).
4. Selecciona la carpeta [`extension/`](extension/).
5. Fija el icono de **Estudio Deep Link** en la barra de herramientas.

---

## Cómo usarla

- **Abrir panel lateral:** haz clic en el icono de la extensión o pulsa `Alt+S`.
- **Desde cualquier página:** haz clic derecho → **Guardar página / minuto en Estudio** o subraya texto y elige **Guardar cita en Estudio**.
- **YouTube:** detecta automáticamente el segundo actual y guarda el enlace con `&t=XXXs`.
- **Coursera:** detecta el segundo actual del reproductor y, cuando vuelvas a abrir la captura desde la biblioteca, la extensión adelanta el video automáticamente a ese minuto.
- **Gemini / NotebookLM / Claude / ChatGPT:** guarda el enlace de la conversación + la cita exacta subrayada y, al reabrir, intenta localizar y resaltar ese fragmento en pantalla.
- **Artículos y webs normales:** genera un enlace nativo de Chrome con *Text Fragment* (`#:~:text=...`).
- **Capturas de pantalla:**
  - Dentro de Chrome: pulsa **Recortar área** (arrastra un rectángulo en la pestaña actual) o **Pestaña entera**.
  - Desde cualquier otra app de Windows: recorta con `Win+Shift+S` y pega directamente con `Ctrl+V` en la pestaña **Capturar**.
  - Todas las capturas se comprimen automáticamente a **WebP** ligero (máx. 1280 px de ancho).

---

## Formato JSON exportado (`schemaVersion: 1`)

Desde la pestaña **Biblioteca** puedes descargar un respaldo completo (**Exportar JSON**) o ligero (**JSON sin fotos**), además de importar respaldos fusionando por `id`:

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-11-24T15:00:00.000Z",
  "source": "app-de-estudios-chrome-extension",
  "projects": [
    {
      "id": "proj_ingenieria_ia",
      "name": "Ingeniería IA",
      "color": "#2563eb",
      "createdAt": "2026-11-24T15:00:00.000Z"
    }
  ],
  "items": [
    {
      "id": "item_abc123",
      "projectId": "proj_ingenieria_ia",
      "categories": ["python", "funciones"],
      "sourceType": "youtube",
      "title": "Python Functions",
      "url": "https://www.youtube.com/watch?v=...",
      "deepLinkUrl": "https://www.youtube.com/watch?v=...&t=245s",
      "timestampSec": 245,
      "quote": "",
      "note": "Ejemplo claro de *args y **kwargs",
      "image": {
        "dataUrl": "data:image/webp;base64,...",
        "mimeType": "image/webp",
        "width": 960,
        "height": 540,
        "sizeBytes": 54210
      },
      "createdAt": "2026-11-24T15:00:00.000Z",
      "updatedAt": "2026-11-24T15:00:00.000Z",
      "syncedAt": null
    }
  ]
}
```
