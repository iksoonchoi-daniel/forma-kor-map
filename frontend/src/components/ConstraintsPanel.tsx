import { useState } from 'react';
import { addEnvelopeElements, getProjectLocation } from '../services/formaService';

interface ConstraintsPanelProps {
  targetFC: any;
  contextFC: any;
}

export default function ConstraintsPanel({ targetFC }: ConstraintsPanelProps) {
  const [bcr, setBcr] = useState<number>(60);
  const [far, setFar] = useState<number>(200);
  const [setback, setSetback] = useState<number>(1);
  const [floorHeight, setFloorHeight] = useState<number>(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>(null);

  const handleGenerateEnvelope = async () => {
    if (!targetFC || !targetFC.features || targetFC.features.length === 0) {
      setError("대지 정보가 없습니다. 먼저 2번 탭에서 대지를 생성해주세요.");
      return;
    }
    
    setLoading(true); setError(null); setSuccess(null);
    try {
      const location = await getProjectLocation();
      if (!location) throw new Error("프로젝트 위치를 알 수 없습니다.");
      const [refLat, refLon] = location;
      
      const result = await addEnvelopeElements(targetFC.features, refLon, refLat, bcr, far, setback, floorHeight);
      
      if (result.metrics) {
        setMetrics(result.metrics);
      }

      setSuccess("성공적으로 건축한계선(3D Envelope) 매스를 생성했습니다!");
    } catch (err: any) {
      setError(err.message || "생성 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const floors = Math.floor(far / bcr);
  const maxHeight = (far / bcr) * floorHeight;

  return (
    <div className="tab-content">
      <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>건축한계선 (3D Envelope) 시각화</h3>
      <p className="description">
        입력하신 법규 정보에 따라 건물이 최대로 들어설 수 있는 3D 가상 공간(Envelope)을 생성합니다.
      </p>

      <div style={{ background: '#f5f5f5', padding: '15px', borderRadius: '8px', marginBottom: '15px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
          
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px', color: '#333' }}>법정 최대 건폐율 (%)</label>
            <input 
              type="number" 
              value={bcr} 
              onChange={(e) => setBcr(Number(e.target.value))} 
              className="text-input" 
              style={{ width: '100%', padding: '8px' }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px', color: '#333' }}>법정 최대 용적률 (%)</label>
            <input 
              type="number" 
              value={far} 
              onChange={(e) => setFar(Number(e.target.value))} 
              className="text-input" 
              style={{ width: '100%', padding: '8px' }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px', color: '#333' }}>대지안의 공지 (기본 이격거리, m)</label>
            <input 
              type="number" 
              value={setback} 
              onChange={(e) => setSetback(Number(e.target.value))} 
              className="text-input" 
              style={{ width: '100%', padding: '8px' }}
              step="0.5"
            />
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px', color: '#333' }}>기준 층고 (m)</label>
            <input 
              type="number" 
              value={floorHeight} 
              onChange={(e) => setFloorHeight(Number(e.target.value))} 
              className="text-input" 
              style={{ width: '100%', padding: '8px' }}
              step="0.1"
            />
          </div>

        </div>
      </div>

      <div style={{ background: '#e3f2fd', padding: '10px', borderRadius: '8px', marginBottom: '15px', display: 'flex', gap: '15px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', color: '#1565c0' }}>예상 최대 층수</div>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0d47a1' }}>약 {floors} 층</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', color: '#1565c0' }}>예상 최고 높이</div>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0d47a1' }}>{maxHeight.toFixed(1)} m</div>
        </div>
      </div>

      <button className="primary-btn" onClick={handleGenerateEnvelope} disabled={loading || !targetFC}>
        {loading ? "생성 중..." : "3D 건축한계선 제네릭 매스 생성"}
      </button>

      {error && <div className="feedback-msg error" style={{ marginTop: '10px' }}>{error}</div>}
      {success && <div className="feedback-msg success" style={{ marginTop: '10px' }}>{success}</div>}

      {metrics && (
        <div style={{ marginTop: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px', background: '#fff' }}>
          <h4 style={{ margin: '0 0 15px 0', fontSize: '14px', color: '#333' }}>📊 건축 법규 검토 요약</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
            <div>
              <span style={{ color: '#666' }}>대지 면적:</span>
              <strong style={{ float: 'right' }}>{metrics.siteArea.toLocaleString(undefined, {maximumFractionDigits: 1})} ㎡</strong>
            </div>
            <div>
              <span style={{ color: '#666' }}>건축 면적 (바닥):</span>
              <strong style={{ float: 'right' }}>{metrics.footprintArea.toLocaleString(undefined, {maximumFractionDigits: 1})} ㎡</strong>
            </div>
            <div>
              <span style={{ color: '#666' }}>예상 건폐율:</span>
              <strong style={{ float: 'right' }}>{((metrics.footprintArea / metrics.siteArea) * 100).toLocaleString(undefined, {maximumFractionDigits: 1})} %</strong>
            </div>
            <div>
              <span style={{ color: '#666' }}>예상 용적률:</span>
              <strong style={{ float: 'right' }}>{((metrics.projectedGfa / metrics.siteArea) * 100).toLocaleString(undefined, {maximumFractionDigits: 1})} %</strong>
            </div>
            <div>
              <span style={{ color: '#666' }}>예상 연면적:</span>
              <strong style={{ float: 'right', color: '#1565c0' }}>{metrics.projectedGfa.toLocaleString(undefined, {maximumFractionDigits: 1})} ㎡</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
