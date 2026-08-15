from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.services.vworld_service import get_cadastre_by_point, get_cadastre_by_bbox, get_cadastre_by_addresses
import uvicorn

app = FastAPI(title="Forma Korea Map API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/cadastre/point")
async def get_cadastre_point(lon: float, lat: float, buffer_meters: float = 300.0):
    try:
        result = get_cadastre_by_point(lon, lat, buffer_meters)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cadastre/bbox")
async def get_cadastre_bbox(minx: float, miny: float, maxx: float, maxy: float):
    try:
        result = get_cadastre_by_bbox(minx, miny, maxx, maxy)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cadastre/address")
async def get_cadastre_address(addresses: str, include_context: bool = False):
    try:
        addr_list = [a.strip() for a in addresses.split(",") if a.strip()]
        result = get_cadastre_by_addresses(addr_list, include_context)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
