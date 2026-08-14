# 🌍 Forma Korea Cadastral Map (한국 지적도 연동 확장 프로그램)

![Forma Extension](https://img.shields.io/badge/Autodesk-Forma-0b57d0?style=for-the-badge&logo=autodesk)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)

Autodesk Forma 환경에서 **대한민국 공간정보오픈플랫폼(VWorld) API**를 활용하여 한국의 연속지적도(Cadastre) 데이터를 빠르고 정확하게 가져오는 확장 프로그램(Extension)입니다. 주소 기반 지오코딩과 다중 필지 자동 병합(Union) 등 강력한 공간 분석 기능을 제공하여 건축 기획의 자동화를 돕습니다.

---

## 🚀 주요 기능 (Features)

### 1. 배경 지적도 (Context Data) 매핑
Forma 프로젝트의 기준점(Ref Point) 주변 반경(100m, 300m, 500m) 내의 모든 연속지적도를 불러옵니다.
* 불러온 데이터는 계산에 영향을 주지 않는 배경 데이터(`category: parcel`)로 처리됩니다.
* Forma 캔버스에 지형 위로 예쁜 지적선이 그려져 전체적인 사이트 맥락을 파악하기 좋습니다.

### 2. 타겟 대지경계선 (Site Limit) 생성
단순한 배경을 넘어, **실제 건축 면적 계산의 기준이 되는 `Site Limit`**을 생성합니다.
* **주소 기반 검색:** "서울시 강남구 테헤란로 123"과 같이 주소를 입력하면 지오코더 API가 자동으로 좌표를 획득하여 정확한 해당 필지만 쏙 뽑아냅니다.
* **스마트 다중 필지 병합:** 주소를 쉼표(,)로 연결하여 여러 개 입력하면(예: `...123, ...125`), **백엔드에서 수학적 공간 병합 알고리즘(`shapely.unary_union`)이 작동하여 완벽하게 이어진 1개의 대지경계선**으로 만들어냅니다.
* 이름 자동 생성, Forma 분석(Analysis) 탭 완벽 연동 지원.

---

## 🏗️ 아키텍처 (Architecture)

* **Frontend (React + Vite):** 
  * `forma-embedded-view-sdk`를 통해 Autodesk Forma와 통신.
  * 좌표 변환기 (WGS84 ➡️ Local Meters).
  * 탭 기반의 직관적인 사용자 인터페이스.
* **Backend (Python + FastAPI):** 
  * VWorld Data API & Geocoder API 통신을 담당하는 프록시 서버 (CORS 문제 해결).
  * `GeoPandas`와 `Shapely`를 활용한 GeoJSON 파싱 및 공간 지오메트리(Geometry) 병합 로직.

---

## 🛠️ 설치 및 실행 방법 (Getting Started)

### 1. 환경 변수 설정
`backend/.env.example` 파일을 복사하여 `backend/.env`를 만들고, 본인의 VWorld API 키를 입력합니다.
```env
VWORLD_API_KEY=YOUR_API_KEY_HERE
VWORLD_DOMAIN=http://localhost:5173
```

### 2. 자동 스크립트로 실행
프로젝트 루트에 있는 실행 스크립트를 통해 한 번에 설치 및 실행이 가능합니다.

**의존성 설치:**
```bash
./install.sh
```

**서버 실행 (Frontend + Backend 동시에 실행):**
```bash
./run.sh
```
* Frontend는 `http://localhost:5173` 에서 실행됩니다.
* Backend는 `http://localhost:8000` 에서 실행됩니다.

### 3. Forma에 Extension 등록
1. Autodesk Forma 프로젝트를 엽니다.
2. 좌측 메뉴 ➡️ Extensions ➡️ Add Extension ➡️ **"Add local extension"** 클릭.
3. URL에 `http://localhost:5173`을 입력하고 추가합니다.
4. 확장 프로그램을 클릭하여 한국 지적도를 자유롭게 불러와 보세요!

---

## 📝 라이선스 (License)
이 프로젝트는 MIT License를 따릅니다. VWorld API의 데이터 저작권 및 사용 조건은 공간정보오픈플랫폼의 정책을 따릅니다.
