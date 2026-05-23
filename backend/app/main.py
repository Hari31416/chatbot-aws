import logging

from fastapi import FastAPI
from mangum import Mangum

from .api.routes import router
from .logging_config import configure_logging

configure_logging()

logger = logging.getLogger(__name__)

app = FastAPI(title="Chatbot API")
app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    logger.debug("Health check requested")
    return {"status": "ok"}


logger.info("Chatbot API initialised")

handler = Mangum(app)

