# [Project Spec] Forma-Korea-Map: 한국 공공 지적도 Forma 자동 임포터 구축

## 1. 프로젝트 개요 (Project Overview)
* **목적**: Autodesk Forma 기본 환경에서 부정확하거나 누락된 한국 지역의 연속지적도 데이터를 VWorld 오픈 API를 통해 실시간으로 수집하고, WGS84 좌표 변환을 거쳐 Forma 캔버스에 `site_limit` 및 `constraint` 요소로 자동 투영하는 풀스택 익스텐션 시스템 구축.
* **주요 구성**:
  1. **Backend**: Ubuntu 기반 FastAPI + GeoPandas 마이크로서비스 (VWorld 연동 및 좌표 변환 파이프라인)
  2. **Frontend**: Forma Embedded View SDK 기반 웹 패널 익스텐션 (React / TypeScript / Vite)

---

## 2. 시스템 아키텍처 및 데이터 흐름 (Architecture & Data Flow)
[Forma 3D Canvas]
│ 1. Extension 패널 실행 & 프로젝트 기준 좌표(lat, lon) 획득 (Forma SDK)
▼
[Frontend Extension (React + Vite)]
│ 2. GET /api/cadastre/point?lon={refLon}&lat={refLat}&buffer_meters=300
▼
[Backend Server (FastAPI + GeoPandas)]
│ 3. VWorld 2D Data API 호출 (LT_C_DGMT_CADASTRE)
▼
[VWorld Open API] ──(GeoJSON 수신)──> [Backend Server]
│ 4. EPSG:5179 -> EPSG:4326(WGS84) 정제 및 GeoPandas 포맷팅
▼
[Frontend Extension]
│ 5. WGS84 좌표 ➔ Forma Local Cartesian 미터 좌표(X, Y) 투영 변환
▼
[Forma Elements API (integrateElements)]
│ 6. category: "site_limit", virtual: true 속성으로 씬 트리에 등록
▼
[Forma Canvas에 대지 경계선 실시간 렌더링 완료]


## 3. 디렉토리 구조 (Project Structure)

```text
forma-korea-map/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI 진입점, CORS, 라우터
│   │   ├── config.py            # 환경변수 (VWORLD_API_KEY 등)
│   │   └── services/
│   │       ├── __init__.py
│   │       └── vworld_service.py # VWorld API 호출 및 GeoPandas 변환 로직
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Extension 메인 UI 컴포넌트
│   │   ├── services/
│   │   │   ├── formaService.ts  # Forma Embedded View SDK 연동
│   │   │   └── coordTransform.ts# WGS84 -> Forma Local 미터 좌표 변환
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── .env.example
├── formaMap.md                  # 본 작업 계획서
└── README.md


4. 단계별 구현 마일스톤 (Implementation Steps)
Phase 1. Backend 환경 구축 & VWorld API 파이프라인 (/backend)
의존성 설정 (requirements.txt)

fastapi, uvicorn[standard], requests, geopandas, shapely, pyproj, python-dotenv

VWorld 연동 서비스 (vworld_service.py) 구현

LT_C_DGMT_CADASTRE (연속지적도) 데이터 호출

Bounding Box 기반 검색 및 중심좌표+반경(m) 기반 검색 로직 작성

EPSG:4326 WGS84 좌표계 검증 및 GeoJSON 직렬화

FastAPI 라우트 (main.py) 구현

GET /api/cadastre/point: lon, lat, buffer_meters 파라미터 수신

GET /api/cadastre/bbox: minx, miny, maxx, maxy 수신

Forma 웹뷰 Iframe 통신을 위한 와일드카드 CORS 허용 (allow_origins=["*"])

Swagger Docs (/docs)를 통한 API 응답 정상 동작 검증

Phase 2. Frontend 익스텐션 개발 (/frontend)
프로젝트 셋업

Vite + React + TypeScript 템플릿 생성

forma-embedded-view-sdk 패키지 설치

좌표 변환 모듈 (coordTransform.ts) 구현

WGS84 [lon, lat] 좌표를 프로젝트 GeoLocation(refLon, refLat) 기준 로컬 평면 미터 [X, Y]로 변환하는 알고리즘 작성

Forma 연동 서비스 (formaService.ts) 구현

Forma.project.getGeoLocation()을 호출하여 대상지 기준점 획득

백엔드 API로부터 GeoJSON 수신 후 FormaElement 구조체 변환:

properties.name: 지번/지목 (예: feature.properties.JIBUN)

properties.category: "site_limit"

properties.virtual: true

representations.footprint: 2D Polygon 미터 좌표

Forma.experimental.elements.integrateElements로 Proposal 트리에 등록

UI 컴포넌트 (App.tsx) 구축

현재 사이트 기준점 상태 표시

반경(100m / 300m / 500m) 선택 슬라이더/버튼

[대지경계선 자동 불러오기] 액션 버튼 및 로딩/에러 상태 피드백 UI

Phase 3. 로컬 테스트 및 Forma DevTools 연동
Backend 로컬 실행 (uvicorn app.main:app --reload --port 8000)

Frontend 로컬 실행 (vite --port 3000)

Autodesk Forma 콘솔의 Settings > Extensions (Developer Mode) 에서 로컬 웹뷰 URL(http://localhost:3000) 등록

실제 한국 사이트(예: 강남역 부근)에서 대지경계선 투영 및 Element Tree 등록 여부 검증

5. 핵심 기술 명세 & 주의사항 (Technical Constraints)
Forma 로컬 좌표계 규칙:

Forma 캔버스는 WGS84 위경도를 직접 받지 않고, 기준점(refPoint)으로부터의 X/Y 거리(미터)를 사용합니다. 반드시 wgs84ToLocalMeters 변환을 거쳐야 형상이 왜곡되지 않고 정상 위치에 투영됩니다.

FormaElement Specification 준수:

지적선은 물리적 메쉬가 아니므로 분석 엔진(일조, 바람 등)에 방해되지 않도록 반드시 properties.virtual: true를 부여합니다.

VWorld API 트래픽 제한:

반경이 너무 넓으면 VWorld API 응답 제한(1,000건)에 걸릴 수 있으므로, 기본 반경은 300m 내외로 제한하고 BBox를 안전하게 분할하도록 설계합니다.

6. 에이전트 지침 (Prompt Instructions for AI Agent)
Python 코드는 타입 힌트와 예외 처리를 엄격히 적용해 주세요.

Vite Frontend 설정 시 HTTPS 또는 Iframe 통신 제약이 발생하지 않도록 vite.config.ts의 서버 설정을 확인해 주세요.

모든 환경변수는 .env를 통해 관리하고 예시 파일(.env.example)을 반드시 포함해 주세요.