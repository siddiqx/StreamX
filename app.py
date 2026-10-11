import os
import sys

# Ensure app package is discoverable
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))
if os.path.exists(os.path.join(os.path.abspath(os.path.dirname(__file__)), "backend")):
    sys.path.insert(0, os.path.join(os.path.abspath(os.path.dirname(__file__)), "backend"))

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
