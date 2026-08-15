import requests
import json
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.config import settings

def test_vworld():
    lon, lat = 127.0276, 37.4979
    params = {
        "service": "data",
        "request": "GetFeature",
        "data": "lp_pa_cbnd_bubun",
        "key": settings.VWORLD_API_KEY,
        "domain": settings.VWORLD_DOMAIN,
        "geomFilter": f"POINT({lon} {lat})",
        "geometry": "false",
        "size": "10"
    }
    response = requests.get("http://api.vworld.kr/req/data", params=params)
    print(response.json())

test_vworld()
