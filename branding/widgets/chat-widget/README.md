# SignConnect Chat Widget

Floating chat panel that connects to the SignConnect AI Assistant backend (`POST /api/chat`).

## Setup

1. In ThingsBoard, go to **Widget Library** → create a new **Widget Bundle** (or use existing SignConnect bundle)
2. Add a new widget of type **Static**
3. Paste contents into the respective tabs:
   - **HTML** tab → `template.html`
   - **CSS** tab → `template.css`
   - **JavaScript** tab → `controller.js`
4. Save the widget, then add it to any dashboard

## Configuration

The backend URL is set at the top of `controller.js`:

```javascript
var API_URL = 'http://46.225.54.21:5001';
```

Change this if the backend runs on a different host/port.

## Requirements

- The AI backend must be running at the configured `API_URL`
- The backend's `CORS_ORIGINS` must include the ThingsBoard URL
- No external JS libraries required — all rendering is self-contained
