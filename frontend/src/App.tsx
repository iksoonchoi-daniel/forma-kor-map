import { useState, useEffect } from 'react'
import { getProjectLocation, addSiteLimitElements } from './services/formaService'
import './index.css'

function App() {
  const [refPoint, setRefPoint] = useState<{ lon: number, lat: number } | null>(null)
  const [buffer, setBuffer] = useState<number>(300)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'context' | 'site'>('context')
  const [addresses, setAddresses] = useState<string>('')

  useEffect(() => {
    // Initialize ref point from Forma
    const initForma = async () => {
      try {
        const location = await getProjectLocation()
        // getGeoLocation() returns [latitude, longitude] array
        if (location && location.length >= 2) {
          const [lat, lon] = location;
          setRefPoint({ lon, lat })
        } else {
          console.warn("Forma 프로젝트 기준점을 가져오지 못했습니다. 임시 좌표를 사용합니다.");
          setRefPoint({ lon: 127.0276, lat: 37.4979 }); 
          setError("Forma 환경이 감지되지 않아 임시 좌표(강남역)를 사용합니다.");
        }
      } catch (err) {
        console.error("Failed to get Forma project location:", err)
        setError("Forma 프로젝트 기준점을 가져오는데 실패했습니다.")
        setRefPoint({ lon: 127.0276, lat: 37.4979 }); 
      }
    }
    initForma()
  }, [])

  const handleImportContext = async () => {
    if (!refPoint) return;
    setLoading(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`http://localhost:8000/api/cadastre/point?lon=${refPoint.lon}&lat=${refPoint.lat}&buffer_meters=${buffer}`)
      if (!response.ok) throw new Error(`API 오류: ${response.status}`)
      
      const geojson = await response.json()
      if (!geojson.features || geojson.features.length === 0) {
        throw new Error("해당 반경 내에 지적도 데이터가 없습니다.")
      }

      await addSiteLimitElements(geojson.features, refPoint.lon, refPoint.lat, "parcel")
      setSuccess(`성공적으로 ${geojson.features.length}개의 지적도를 배경(Parcel)으로 임포트했습니다.`)
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const handleImportSiteLimit = async () => {
    if (!refPoint) return;
    if (!addresses.trim()) {
      setError("주소를 입력해주세요."); return;
    }
    setLoading(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`http://localhost:8000/api/cadastre/address?addresses=${encodeURIComponent(addresses)}`)
      if (!response.ok) throw new Error(`API 오류: ${response.status}`)
      
      const geojson = await response.json()
      if (!geojson.features || geojson.features.length === 0) {
        throw new Error("해당 주소의 지적도 데이터를 찾을 수 없습니다.")
      }

      await addSiteLimitElements(geojson.features, refPoint.lon, refPoint.lat, "site_limit")
      setSuccess(`성공적으로 주소지의 지적도를 대지경계선(Site Limit)으로 임포트했습니다.`)
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="extension-container">
      <h1>한국 연속지적도 임포터</h1>
      
      <div className="tabs">
        <button 
          className={`tab-btn ${activeTab === 'context' ? 'active' : ''}`}
          onClick={() => { setActiveTab('context'); setError(null); setSuccess(null); }}
        >
          배경 지적도 (Context)
        </button>
        <button 
          className={`tab-btn ${activeTab === 'site' ? 'active' : ''}`}
          onClick={() => { setActiveTab('site'); setError(null); setSuccess(null); }}
        >
          타겟 대지경계선 (Site Limit)
        </button>
      </div>

      {activeTab === 'context' && (
        <div className="tab-content">
          <p className="description">현재 위치 주변의 지적도를 불러와 계산에 영향을 주지 않는 배경(Parcel)으로 렌더링합니다.</p>
          <div className="status-panel">
            <div className="status-item"><span className="label">경도:</span><span className="value">{refPoint?.lon?.toFixed(6) || "로딩중..."}</span></div>
            <div className="status-item"><span className="label">위도:</span><span className="value">{refPoint?.lat?.toFixed(6) || "로딩중..."}</span></div>
          </div>
          <div className="control-panel">
            <label>검색 반경:</label>
            <select value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} disabled={loading}>
              <option value={100}>100m</option>
              <option value={300}>300m</option>
              <option value={500}>500m</option>
            </select>
          </div>
          <button className="primary-btn" onClick={handleImportContext} disabled={loading || !refPoint}>
            {loading ? "불러오는 중..." : "배경 지적도 가져오기"}
          </button>
        </div>
      )}

      {activeTab === 'site' && (
        <div className="tab-content">
          <p className="description">주소를 입력하여 해당 필지만을 건축 면적 계산의 기준이 되는 '대지경계선'으로 생성합니다.</p>
          <div className="control-panel vertical">
            <label>주소 입력 (쉼표로 구분하여 여러 필지 합치기 가능):</label>
            <textarea 
              value={addresses} 
              onChange={(e) => setAddresses(e.target.value)}
              placeholder="예: 서울특별시 강남구 테헤란로 123, 서울특별시 강남구 테헤란로 125"
              disabled={loading}
              rows={3}
              className="text-input"
            />
          </div>
          <button className="primary-btn" onClick={handleImportSiteLimit} disabled={loading || !refPoint}>
            {loading ? "불러오는 중..." : "대지경계선 생성하기"}
          </button>
        </div>
      )}

      {error && <div className="feedback-msg error">{error}</div>}
      {success && <div className="feedback-msg success">{success}</div>}
    </div>
  )
}

export default App
