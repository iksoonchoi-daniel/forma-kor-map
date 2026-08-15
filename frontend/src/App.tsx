import { useState, useEffect, useRef } from 'react'
import { getProjectLocation, addSiteLimitElements } from './services/formaService'
import SiteInfoPanel from './components/SiteInfoPanel'
import './index.css'

function App() {
  const [refPoint, setRefPoint] = useState<{ lon: number, lat: number } | null>(null)
  const [buffer, setBuffer] = useState<number>(300)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'context' | 'site' | 'info'>('context')
  const [addresses, setAddresses] = useState<string>('')
  const [includeContext, setIncludeContext] = useState<boolean>(false)
  const [analysisData, setAnalysisData] = useState<{targetFC: any, contextFC: any} | null>(null)
  
  const currentPnuRef = useRef<string | null>(null);

  useEffect(() => {
    currentPnuRef.current = analysisData?.targetFC?.features?.[0]?.properties?.pnu || null;
  }, [analysisData]);

  useEffect(() => {
    // Initialize ref point from Forma
    const initForma = async () => {
      try {
        const location = await getProjectLocation()
        if (location && location.length >= 2) {
          const [lat, lon] = location;
          setRefPoint({ lon, lat })
        } else {
          console.warn("Forma 프로젝트 기준점을 가져오지 못했습니다. 임시 좌표를 사용합니다.");
          setRefPoint({ lon: 127.0276, lat: 37.4979 }); 
          setError("Forma 환경이 감지되지 않아 임시 좌표(강남역)를 사용합니다.");
        }

        // Load cached analysis data
        try {
          const { Forma } = await import("forma-embedded-view-sdk/auto");
          const project = await Forma.project.get();
          const localKey = `forma-cadastre-analysis-${project.hubId}-${project.name}`;
          const cached = localStorage.getItem(localKey);
          if (cached) {
            setAnalysisData(JSON.parse(cached));
          }
        } catch (e) {
          console.warn("Failed to load cached analysis data", e);
        }

      } catch (err) {
        console.error("Failed to get Forma project location:", err)
        setError("Forma 프로젝트 기준점을 가져오는데 실패했습니다.")
        setRefPoint({ lon: 127.0276, lat: 37.4979 }); 
      }
    }
    initForma()
  }, [])

  // Auto-fill address and analysis data when user selects a polygon in Forma
  useEffect(() => {
    let unsubscribe: () => void;
    const setupSelection = async () => {
      try {
        const { Forma } = await import("forma-embedded-view-sdk/auto");
        const sub = await Forma.selection.subscribe(async ({ paths }) => {
          if (!paths || paths.length === 0) return;
          try {
            const footprint = await Forma.geometry.getFootprint({ path: paths[0] });
            if (!footprint || !footprint.coordinates || footprint.coordinates.length === 0) return;
            
            let cx = 0, cy = 0, count = 0;
            footprint.coordinates.forEach((c: [number, number]) => {
              cx += c[0]; cy += c[1]; count++;
            });
            cx /= count; cy /= count;
            
            const location = await Forma.project.getGeoLocation();
            if (!location) return;
            const [refLat, refLon] = location;
            
            const { localMetersToWgs84 } = await import("./services/coordTransform");
            const [lon, lat] = localMetersToWgs84(refLon, refLat, cx, cy);
            
            const res = await fetch(`http://localhost:8000/api/cadastre/reverse?lon=${lon}&lat=${lat}&include_context=${includeContext}`);
            if (res.ok) {
              const data = await res.json();
              if (data.target && data.target.features && data.target.features.length > 0) {
                const jibun = data.target.features[0].properties?.jibun;
                const pnu = data.target.features[0].properties?.pnu;
                
                // If this is the exact same parcel we just generated/loaded, do nothing
                // to avoid overwriting the user's typed address.
                if (pnu && pnu === currentPnuRef.current) {
                  return;
                }
                
                if (jibun) {
                  setAddresses(jibun); // Auto-fill the address input!
                  setAnalysisData({ targetFC: data.target, contextFC: data.context }); // Auto-fill the 3rd tab!
                }
              }
            }
          } catch(e) { 
            console.error("Selection reverse geocoding failed", e); 
          }
        });
        unsubscribe = sub.unsubscribe;
      } catch(e) {}
    };
    setupSelection();
    return () => { if (unsubscribe) unsubscribe(); };
  }, [includeContext]);

  const handleImportContext = async () => {
    if (!refPoint) return;
    setLoading(true); setError(null); setSuccess(null);
    try {
      // 1. Get terrain bounds in local meters
      const { Forma } = await import("forma-embedded-view-sdk/auto");
      const bbox = await Forma.terrain.getBbox();
      
      // 2. Convert to WGS84 bounding box
      const { localMetersToWgs84 } = await import("./services/coordTransform");
      const [lon1, lat1] = localMetersToWgs84(refPoint.lon, refPoint.lat, bbox.min.x, bbox.min.y);
      const [lon2, lat2] = localMetersToWgs84(refPoint.lon, refPoint.lat, bbox.max.x, bbox.max.y);

      const minLon = Math.min(lon1, lon2);
      const maxLon = Math.max(lon1, lon2);
      const minLat = Math.min(lat1, lat2);
      const maxLat = Math.max(lat1, lat2);

      // 3. Fetch exact cadastre within this box
      const response = await fetch(`http://localhost:8000/api/cadastre/bbox?minx=${minLon}&miny=${minLat}&maxx=${maxLon}&maxy=${maxLat}`)
      if (!response.ok) throw new Error(`API 오류: ${response.status}`)
      
      const geojson = await response.json()
      if (!geojson.features || geojson.features.length === 0) {
        throw new Error("해당 씬(Scene) 영역 내에 지적도 데이터가 없습니다.")
      }

      await addSiteLimitElements(geojson.features, refPoint.lon, refPoint.lat, "지적도")
      setSuccess(`성공적으로 ${geojson.features.length}개의 지적도를 씬(Scene) 영역에 맞게 임포트했습니다.`)
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
      const response = await fetch(`http://localhost:8000/api/cadastre/address?addresses=${encodeURIComponent(addresses)}&include_context=${includeContext}`)
      if (!response.ok) throw new Error(`API 오류: ${response.status}`)
      
      const result = await response.json()
      const targetFC = result.target
      const contextFC = result.context

      if (!targetFC || !targetFC.features || targetFC.features.length === 0) {
        throw new Error("해당 주소의 지적도 데이터를 찾을 수 없습니다.")
      }

      await addSiteLimitElements(targetFC.features, refPoint.lon, refPoint.lat, "site_limit")
      
      let msg = `성공적으로 주소지의 지적도를 대지경계선(Site Limit)으로 임포트했습니다.`
      if (contextFC && contextFC.features && contextFC.features.length > 0) {
        await addSiteLimitElements(contextFC.features, refPoint.lon, refPoint.lat, "지적도")
        msg += ` 주변 50m 지적도(${contextFC.features.length}개)도 함께 배경으로 임포트했습니다.`
      }
      
      setAnalysisData({ targetFC, contextFC });
      try {
        const { Forma } = await import("forma-embedded-view-sdk/auto");
        const project = await Forma.project.get();
        const localKey = `forma-cadastre-analysis-${project.hubId}-${project.name}`;
        localStorage.setItem(localKey, JSON.stringify({ targetFC, contextFC }));
      } catch(e) { 
        console.error("Failed to cache analysis data", e); 
      }
      setSuccess(msg)
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
        <button 
          className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => { setActiveTab('info'); setError(null); setSuccess(null); }}
        >
          대지정보 (Analysis)
        </button>
      </div>

      {activeTab === 'context' && (
        <div className="tab-content">
          <p className="description">현재 위치 주변의 지적도를 불러와 계산에 영향을 주지 않는 배경(Parcel)으로 렌더링합니다.</p>
          <div className="status-panel">
            <div className="status-item"><span className="label">경도:</span><span className="value">{refPoint?.lon?.toFixed(6) || "로딩중..."}</span></div>
            <div className="status-item"><span className="label">위도:</span><span className="value">{refPoint?.lat?.toFixed(6) || "로딩중..."}</span></div>
          </div>
          <button className="primary-btn" onClick={handleImportContext} disabled={loading || !refPoint}>
            {loading ? "불러오는 중..." : "배경 지적도 가져오기 (씬 전체)"}
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
            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
              <input 
                type="checkbox" 
                checked={includeContext} 
                onChange={(e) => setIncludeContext(e.target.checked)} 
                disabled={loading}
              />
              주변 50m 연속지적도 함께 불러오기 (배경선)
            </label>
          </div>
          <button className="primary-btn" onClick={handleImportSiteLimit} disabled={loading || !refPoint}>
            {loading ? "불러오는 중..." : "대지경계선 생성하기"}
          </button>
        </div>
      )}

      {activeTab === 'info' && (
        <SiteInfoPanel 
          targetFC={analysisData?.targetFC} 
          contextFC={analysisData?.contextFC} 
        />
      )}

      {error && <div className="feedback-msg error">{error}</div>}
      {success && <div className="feedback-msg success">{success}</div>}
    </div>
  )
}

export default App
