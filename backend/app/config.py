import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    VWORLD_API_KEY: str = os.getenv("VWORLD_API_KEY", "")
    VWORLD_DOMAIN: str = os.getenv("VWORLD_DOMAIN", "http://localhost:3000")

settings = Settings()
