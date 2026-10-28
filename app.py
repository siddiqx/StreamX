import os
import sys

# Ensure backend package is discoverable first before current dir to avoid self-import conflict
backend_dir = os.path.join(os.path.abspath(os.path.dirname(__file__)), "backend")
if os.path.exists(backend_dir) and backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app as fastapi_app

try:
    import gradio as gr
    with gr.Blocks(title="StreamX Media Server") as demo:
        gr.Markdown("# 🎬 StreamX Cinema Cloud Engine")
        gr.Markdown(
            "**Status**: 🟢 **Online 24/7**\n\n"
            "StreamX FastAPI backend is running.\n\n"
            "- **Health**: [/health](/health)\n"
            "- **Media**: [/media](/media)\n"
            "- **Categories**: [/media/categories](/media/categories)\n"
        )
    # Mount FastAPI so all API routes are accessible at root /
    app = gr.mount_gradio_app(fastapi_app, demo, path="/status")
except Exception:
    app = fastapi_app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
