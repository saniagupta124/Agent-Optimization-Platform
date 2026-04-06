from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.request import LogRequestInput, LogRequestResponse
from app.services.ingestion_service import ingest_request

router = APIRouter()


@router.post("/log_request", response_model=LogRequestResponse)
async def log_request(payload: LogRequestInput, db: Session = Depends(get_db)):
    try:
        record = await ingest_request(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return record
