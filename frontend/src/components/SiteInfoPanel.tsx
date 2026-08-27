import { useEffect, useState, useMemo } from 'react';
import { wgs84ToLocalMeters } from '../services/coordTransform';
import { getProjectLocation } from '../services/formaService';

interface SiteInfoPanelProps {
  targetFC: any;
  contextFC: any;
}

interface Point {
  x: number;
  y: number;
  z?: number;
  svgX?: number;
  svgY?: number;
}

interface RawPolygon {
  id: string;
  isTarget: boolean;
  type: string; 
  jibun: string;
  points: Point[];
  minX: number; maxX: number; minY: number; maxY: number;
}

export default function SiteInfoPanel({ targetFC, contextFC }: SiteInfoPanelProps) {
  const [rawPolygons, setRawPolygons] = useState<RawPolygon[]>([]);
  const [rawElevations, setRawElevations] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const [area, setArea] = useState<number>(0);
  const [zoomPadding, setZoomPadding] = useState<number>(20);
  const [zoning, setZoning] = useState<string>('');
  const [roads, setRoads] = useState<RawPolygon[]>([]);
  
  const [northSunlightData, setNorthSunlightData] = useState<any[]>([]);

  useEffect(() => {
    async function analyzeSite() {
      if (!targetFC || !targetFC.features || targetFC.features.length === 0) return;
      setLoading(true);

      try {
        const location = await getProjectLocation();
        if (!location || location.length < 2) throw new Error("No ref point");
        const [refLat, refLon] = location;

        const allPolygons: RawPolygon[] = [];

        // Helper to parse features
        const parseFeatures = (features: any[], isTarget: boolean) => {
          features.forEach((f, fIdx) => {
            const props = f.properties || {};
            const jibun = props.jibun || props.pnu || (isTarget ? "Target" : "");
            if (!jibun && !isTarget) return;

            const lastChar = jibun.trim().slice(-1);
            let type = "대지";
            if (lastChar === "도") type = "도로";
            else if (lastChar === "공") type = "공원";
            else if (lastChar === "임") type = "임야";
            else if (lastChar === "답" || lastChar === "전") type = "농지";

            let rings = [];
            if (f.geometry.type === "MultiPolygon") {
              rings = f.geometry.coordinates.map((poly: any) => poly[0]); // outer rings
            } else if (f.geometry.type === "Polygon") {
              rings = [f.geometry.coordinates[0]];
            }

            rings.forEach((ring: any, rIdx: number) => {
              const localPts = ring.map((c: number[]) => {
                const [x, y] = wgs84ToLocalMeters(refLon, refLat, c[0], c[1]);
                return { x, y };
              });
              
              let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity;
              const uniquePts = localPts.slice(0, -1);
              uniquePts.forEach((p: any) => { 
                if (p.x < cMinX) cMinX = p.x;
                if (p.x > cMaxX) cMaxX = p.x;
                if (p.y < cMinY) cMinY = p.y;
                if (p.y > cMaxY) cMaxY = p.y;
              });

              allPolygons.push({
                id: (isTarget ? 'target_' : 'context_') + fIdx + '_' + rIdx,
                isTarget,
                type,
                jibun,
                points: localPts,
                minX: cMinX, maxX: cMaxX, minY: cMinY, maxY: cMaxY
              });
            });
          });
        };

        if (contextFC && contextFC.features) parseFeatures(contextFC.features, false);
        parseFeatures(targetFC.features, true);

        // Filter Context Polygons to only Direct Adjacency (< 1m distance)
        const targetPolys = allPolygons.filter(p => p.isTarget);
        
        const distToSegmentSquared = (p: any, v: any, w: any) => {
          const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
          if (l2 === 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
          let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
          t = Math.max(0, Math.min(1, t));
          return (p.x - (v.x + t * (w.x - v.x)))**2 + (p.y - (v.y + t * (w.y - v.y)))**2;
        };

        const filteredPolygons = allPolygons.filter(poly => {
          if (poly.isTarget) return true;
          // check adjacency
          for (const tgt of targetPolys) {
            if (poly.maxX < tgt.minX - 1 || poly.minX > tgt.maxX + 1 ||
                poly.maxY < tgt.minY - 1 || poly.minY > tgt.maxY + 1) continue;
            
            for (const pt of poly.points) {
              for (let i = 0; i < tgt.points.length - 1; i++) {
                if (distToSegmentSquared(pt, tgt.points[i], tgt.points[i+1]) < 1.0) return true;
              }
            }
            for (const pt of tgt.points) {
              for (let i = 0; i < poly.points.length - 1; i++) {
                if (distToSegmentSquared(pt, poly.points[i], poly.points[i+1]) < 1.0) return true;
              }
            }
          }
          return false;
        });

        const northPolygons = filteredPolygons.filter(poly => {
          if (poly.isTarget) return false;
          let targetCy = 0;
          targetPolys[0].points.slice(0, -1).forEach((p: any) => targetCy += p.y);
          targetCy /= (targetPolys[0].points.length - 1);
          
          let polyCy = 0;
          poly.points.slice(0, -1).forEach((p: any) => polyCy += p.y);
          polyCy /= (poly.points.length - 1);
          return polyCy > targetCy;
        });

        let rawSharedPoints: any[] = [];
        let polySharedEdges: any[] = [];
        const tgt = targetPolys[0];

        for (const poly of northPolygons) {
            let sharedForPoly: any[] = [];
            for (let i = 0; i < tgt.points.length - 1; i++) {
                const p1 = tgt.points[i];
                const p2 = tgt.points[i+1];
                let p1Close = false, p2Close = false;
                for (let j = 0; j < poly.points.length - 1; j++) {
                   if (distToSegmentSquared(p1, poly.points[j], poly.points[j+1]) < 1.0) p1Close = true;
                   if (distToSegmentSquared(p2, poly.points[j], poly.points[j+1]) < 1.0) p2Close = true;
                }
                if (p1Close && p2Close) {
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    // Reject vertical (East/West) walls: slope must be more horizontal than vertical
                    if (Math.abs(dx) < Math.abs(dy) * 1.1) continue; 
                    
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    
                    // True North edge check
                    let hitCount = 0;
                    const tgtPts = targetPolys[0].points;
                    for (let k = 0; k < tgtPts.length - 1; k++) {
                        const v1 = tgtPts[k];
                        const v2 = tgtPts[k+1];
                        const minX = Math.min(v1.x, v2.x);
                        const maxX = Math.max(v1.x, v2.x);
                        if (midX > minX && midX <= maxX) {
                            const t = (midX - v1.x) / (v2.x - v1.x);
                            const intersectY = v1.y + t * (v2.y - v1.y);
                            if (intersectY > midY + 0.01) hitCount++;
                        }
                    }
                    if (hitCount % 2 === 0) {
                        sharedForPoly.push(p1, p2);
                    }
                }
            }
            if (sharedForPoly.length > 0) {
                rawSharedPoints.push(...sharedForPoly);
                sharedForPoly.sort((a, b) => a.x - b.x);
                polySharedEdges.push({
                    poly,
                    left: sharedForPoly[0],
                    right: sharedForPoly[sharedForPoly.length - 1]
                });
            }
        }

        rawSharedPoints.sort((a, b) => Math.abs(a.x - b.x) > 0.01 ? a.x - b.x : a.y - b.y);
        const uniqueSharedPoints: any[] = [];
        rawSharedPoints.forEach(pt => {
            if (uniqueSharedPoints.length === 0) {
                uniqueSharedPoints.push(pt);
            } else {
                const last = uniqueSharedPoints[uniqueSharedPoints.length - 1];
                const dist = Math.sqrt((pt.x - last.x)**2 + (pt.y - last.y)**2);
                if (dist > 0.1) uniqueSharedPoints.push(pt);
            }
        });

        const rayIntersectPolygon = (origin: any, dir: any, pts: any[]) => {
            let maxT = -1;
            let hitPt = origin;
            for (let i = 0; i < pts.length - 1; i++) {
                const v1 = pts[i];
                const v2 = pts[i+1];
                const dx = v2.x - v1.x;
                const dy = v2.y - v1.y;
                const det = dir.x * dy - dir.y * dx;
                if (Math.abs(det) < 0.0001) continue; 
                const tx = v1.x - origin.x;
                const ty = v1.y - origin.y;
                const t = (tx * dy - ty * dx) / det;
                const u = (tx * dir.y - ty * dir.x) / det;
                if (t > 0.01 && u >= -0.01 && u <= 1.01) {
                    if (t > maxT) {
                        maxT = t;
                        hitPt = { x: origin.x + t * dir.x, y: origin.y + t * dir.y };
                    }
                }
            }
            return hitPt;
        };

        const getRayDirection = (idx: number, P: any) => {
            if (idx === 0) {
                const P1 = uniqueSharedPoints[1] || P;
                const pIdx = targetPolys[0].points.findIndex((v: any) => Math.hypot(v.x - P.x, v.y - P.y) < 0.5);
                if (pIdx >= 0) {
                    const n = targetPolys[0].points.length - 1;
                    const vPrev = targetPolys[0].points[(pIdx - 1 + n) % n];
                    const vNext = targetPolys[0].points[(pIdx + 1) % n];
                    const dPrev = Math.hypot(vPrev.x - P1.x, vPrev.y - P1.y);
                    const dNext = Math.hypot(vNext.x - P1.x, vNext.y - P1.y);
                    const P_west = (dPrev > dNext) ? vPrev : vNext;
                    return { x: P.x - P_west.x, y: P.y - P_west.y };
                }
            } else if (idx === uniqueSharedPoints.length - 1) {
                const P_prev = uniqueSharedPoints[idx - 1] || P;
                const pIdx = targetPolys[0].points.findIndex((v: any) => Math.hypot(v.x - P.x, v.y - P.y) < 0.5);
                if (pIdx >= 0) {
                    const n = targetPolys[0].points.length - 1;
                    const vPrev = targetPolys[0].points[(pIdx - 1 + n) % n];
                    const vNext = targetPolys[0].points[(pIdx + 1) % n];
                    const dPrev = Math.hypot(vPrev.x - P_prev.x, vPrev.y - P_prev.y);
                    const dNext = Math.hypot(vNext.x - P_prev.x, vNext.y - P_prev.y);
                    const P_east = (dPrev > dNext) ? vPrev : vNext;
                    return { x: P.x - P_east.x, y: P.y - P_east.y };
                }
            } else {
                const leftPolyEdge = polySharedEdges.find(e => Math.hypot(e.right.x - P.x, e.right.y - P.y) < 0.5);
                if (leftPolyEdge) {
                    const polyPts = leftPolyEdge.poly.points.slice(0, -1);
                    const P_prev = uniqueSharedPoints[idx - 1];
                    const pIdx = polyPts.findIndex((v: any) => Math.hypot(v.x - P.x, v.y - P.y) < 0.5);
                    if (pIdx >= 0) {
                        const n = polyPts.length;
                        const vPrev = polyPts[(pIdx - 1 + n) % n];
                        const vNext = polyPts[(pIdx + 1) % n];
                        const dPrev = Math.hypot(vPrev.x - P_prev.x, vPrev.y - P_prev.y);
                        const dNext = Math.hypot(vNext.x - P_prev.x, vNext.y - P_prev.y);
                        const P_mid = (dPrev > dNext) ? vPrev : vNext;
                        return { x: P_mid.x - P.x, y: P_mid.y - P.y };
                    }
                }
            }
            return { x: 0, y: 1 };
        };

        const { Forma } = await import("forma-embedded-view-sdk/auto");
        const uniqueSharedData: any[] = [];
        for (let i = 0; i < uniqueSharedPoints.length; i++) {
            const P = uniqueSharedPoints[i];
            const dir = getRayDirection(i, P);
            const len = Math.hypot(dir.x, dir.y);
            const ndir = len > 0 ? { x: dir.x/len, y: dir.y/len } : { x: 0, y: 1 };
            
            let polyPts: any[] = [];
            if (i === uniqueSharedPoints.length - 1) {
                const edge = polySharedEdges.find(e => Math.hypot(e.right.x - P.x, e.right.y - P.y) < 0.5);
                if (edge) polyPts = edge.poly.points;
            } else {
                const edge = polySharedEdges.find(e => Math.hypot(e.left.x - P.x, e.left.y - P.y) < 0.5);
                if (edge) polyPts = edge.poly.points;
                if (!polyPts.length) {
                    const altEdge = polySharedEdges.find(e => Math.hypot(e.right.x - P.x, e.right.y - P.y) < 0.5);
                    if (altEdge) polyPts = altEdge.poly.points;
                }
            }
            
            let primePt = { x: P.x + ndir.x * 10, y: P.y + ndir.y * 10 };
            if (polyPts.length > 0) {
                primePt = rayIntersectPolygon(P, ndir, polyPts);
            }
            
            const Z = await Forma.terrain.getElevationAt({ x: P.x, y: P.y }) || 0;
            const Z_prime = await Forma.terrain.getElevationAt({ x: primePt.x, y: primePt.y }) || 0;
            
            uniqueSharedData.push({
                pt: { ...P, z: Z },
                prime: { ...primePt, z: Z_prime },
                label: String.fromCharCode(65 + i)
            });
        }

        const globalAverageLvl = uniqueSharedData.length > 0 
            ? uniqueSharedData.reduce((sum, d) => sum + (d.pt.z + d.prime.z) / 2, 0) / uniqueSharedData.length 
            : 0;

        polySharedEdges.sort((a, b) => a.left.x - b.left.x);
        
        const sunlightDataList: any[] = [];
        for (const { poly, left, right } of polySharedEdges) {
            const leftData = uniqueSharedData.find(d => Math.hypot(d.pt.x - left.x, d.pt.y - left.y) < 0.5);
            const rightData = uniqueSharedData.find(d => Math.hypot(d.pt.x - right.x, d.pt.y - right.y) < 0.5);
            if (!leftData || !rightData) continue;
            
            const adjAvgStart = (leftData.pt.z + leftData.prime.z) / 2;
            const finalStartLvl = (leftData.pt.z + adjAvgStart) / 2;

            const adjAvgEnd = (rightData.pt.z + rightData.prime.z) / 2;
            const finalEndLvl = (rightData.pt.z + adjAvgEnd) / 2;
            
            const finalAverageLvl = (finalStartLvl + finalEndLvl) / 2;

            sunlightDataList.push({
               polyJibun: poly.jibun,
               startLabel: leftData.label,
               endLabel: rightData.label,
               A: leftData.pt, Aprime: leftData.prime,
               B: rightData.pt, Bprime: rightData.prime,
               finalStartLvl, finalEndLvl, finalAverageLvl, globalAverageLvl
            });
        }
        setNorthSunlightData(sunlightDataList);

        // Calculate Area for target polygons
        let calcArea = 0;
        targetPolys.forEach(poly => {
          let polyArea = 0;
          for (let i = 0; i < poly.points.length - 1; i++) {
            polyArea += poly.points[i].x * poly.points[i+1].y - poly.points[i+1].x * poly.points[i].y;
          }
          calcArea += Math.abs(polyArea / 2);
        });
        setArea(calcArea);

        // Fetch Elevations for target polygon vertices
        const elevationData: Point[] = [];
        
        for (const poly of targetPolys) {
          const uniquePoints = poly.points.slice(0, -1);
          for (const pt of uniquePoints) {
            const z = await Forma.terrain.getElevationAt({ x: pt.x, y: pt.y });
            elevationData.push({ x: pt.x, y: pt.y, z });
          }
        }

        const adjacentRoads = filteredPolygons.filter(p => !p.isTarget && p.type === "도로");
        setRoads(adjacentRoads);
        
        const zProp = targetFC.features[0].properties?.zoning || "정보 없음 (역추적 필요)";
        setZoning(zProp);

        setRawPolygons(filteredPolygons);
        setRawElevations(elevationData);

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    analyzeSite();
    setZoomPadding(20); // reset zoom on new site
  }, [targetFC, contextFC]);

  // Synchronously compute SVG mappings based on zoom slider
  const { mappedPolygons, mappedElevations, mappedSunlightLines } = useMemo(() => {
    if (rawPolygons.length === 0) return { mappedPolygons: [], mappedElevations: [], mappedSunlightLines: [] };

    let tMinX = Infinity, tMaxX = -Infinity, tMinY = Infinity, tMaxY = -Infinity;
    rawPolygons.filter(p => p.isTarget).forEach(poly => {
      poly.points.forEach(p => {
        if (p.x < tMinX) tMinX = p.x;
        if (p.x > tMaxX) tMaxX = p.x;
        if (p.y < tMinY) tMinY = p.y;
        if (p.y > tMaxY) tMaxY = p.y;
      });
    });

    const minX = tMinX - zoomPadding;
    const maxX = tMaxX + zoomPadding;
    const minY = tMinY - zoomPadding;
    const maxY = tMaxY + zoomPadding;

    const width = maxX - minX;
    const height = maxY - minY;
    
    const viewBoxSize = 500;
    const padding = 40;
    const size = viewBoxSize - padding * 2;
    
    const scale = size / (Math.max(width, height) || 1);
    
    const drawnWidth = width * scale;
    const drawnHeight = height * scale;

    const xOffset = (viewBoxSize - drawnWidth) / 2;
    const yOffset = (viewBoxSize - drawnHeight) / 2;

    const mappedPols = rawPolygons.map(poly => {
      const points = poly.points.map(v => ({
        ...v,
        svgX: (v.x - minX) * scale + xOffset,
        svgY: (maxY - v.y) * scale + yOffset 
      }));

      let visiblePoints = poly.points.filter(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
      if (visiblePoints.length === 0) visiblePoints = poly.points;
      
      let cx = 0, cy = 0;
      visiblePoints.forEach(p => { cx += p.x; cy += p.y; });
      cx /= (visiblePoints.length || 1);
      cy /= (visiblePoints.length || 1);

      return {
        ...poly,
        points,
        centroid: {
          svgX: (cx - minX) * scale + xOffset,
          svgY: (maxY - cy) * scale + yOffset
        }
      };
    });

    const mappedElevs = rawElevations.map(v => ({
      ...v,
      svgX: (v.x - minX) * scale + xOffset,
      svgY: (maxY - v.y) * scale + yOffset
    }));

    const mappedSunlightData: any[] = [];
    const processedLabels = new Set();
    
    northSunlightData.forEach(sd => {
      const pA = { ...sd.A, svgX: (sd.A.x - minX) * scale + xOffset, svgY: (maxY - sd.A.y) * scale + yOffset };
      const pAp = { ...sd.Aprime, svgX: (sd.Aprime.x - minX) * scale + xOffset, svgY: (maxY - sd.Aprime.y) * scale + yOffset };
      if (!processedLabels.has(sd.startLabel)) {
          mappedSunlightData.push({ pt: pA, prime: pAp, label: sd.startLabel, z: sd.A.z });
          processedLabels.add(sd.startLabel);
      }
      
      const pB = { ...sd.B, svgX: (sd.B.x - minX) * scale + xOffset, svgY: (maxY - sd.B.y) * scale + yOffset };
      const pBp = { ...sd.Bprime, svgX: (sd.Bprime.x - minX) * scale + xOffset, svgY: (maxY - sd.Bprime.y) * scale + yOffset };
      if (!processedLabels.has(sd.endLabel)) {
          mappedSunlightData.push({ pt: pB, prime: pBp, label: sd.endLabel, z: sd.B.z });
          processedLabels.add(sd.endLabel);
      }
    });

    return { mappedPolygons: mappedPols, mappedElevations: mappedElevs, mappedSunlightLines: mappedSunlightData };
  }, [rawPolygons, rawElevations, zoomPadding, northSunlightData]);

  if (!targetFC) {
    return <div className="tab-content"><p className="description">두 번째 탭(타겟 대지경계선)에서 대지를 먼저 생성해주세요.</p></div>;
  }

  if (loading) {
    return <div className="tab-content"><p>대지 정보와 주변 지적도를 분석 중입니다...</p></div>;
  }

  const maxZ = rawElevations.length > 0 ? Math.max(...rawElevations.map(v => v.z || 0)) : 0;
  const minZ = rawElevations.length > 0 ? Math.min(...rawElevations.map(v => v.z || 0)) : 0;
  const diff = maxZ - minZ;

  const contextPolys = mappedPolygons.filter(p => !p.isTarget);
  const targetPolys = mappedPolygons.filter(p => p.isTarget);

  const getFillColor = (type: string) => {
    if (type === "도로") return "#e0e0e0";
    if (type === "공원") return "#dcedc8";
    if (type === "임야") return "#c8e6c9";
    if (type === "농지") return "#fff9c4";
    return "#f5f5f5";
  };

  const getFormattedJibun = () => {
    const props = targetFC?.features?.[0]?.properties;
    if (!props) return '지번 정보 없음';
    
    const addr = props.addr;
    const jibun = props.jibun || '';
    
    if (jibun.includes('외')) {
       // 다중 필지인 경우
       const parts = addr ? addr.split(' ') : [];
       const dong = parts.length >= 2 ? parts[parts.length - 2] : '';
       return dong ? `${dong} ${jibun}` : jibun;
    }
    
    const lastChar = jibun.trim().slice(-1);
    const jimok = isNaN(Number(lastChar)) ? lastChar : '';
    
    if (addr) {
      const parts = addr.split(' ');
      if (parts.length >= 2) {
        return `${parts[parts.length - 2]} ${parts[parts.length - 1]} ${jimok ? '('+jimok+')' : ''}`;
      }
      return `${addr} ${jimok ? '('+jimok+')' : ''}`;
    }
    
    return jibun;
  };

  const targetJibun = getFormattedJibun();

  return (
    <div className="tab-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '16px' }}>대지 및 주변 현황 분석 리포트</h3>
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#1565c0', background: '#e3f2fd', padding: '4px 8px', borderRadius: '4px' }}>
          📍 {targetJibun}
        </span>
      </div>
      
      <div style={{ display: 'flex', gap: '15px', marginBottom: '15px', background: '#f5f5f5', padding: '10px', borderRadius: '8px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', color: '#666' }}>건축 대지 면적</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{area.toLocaleString(undefined, {maximumFractionDigits: 1})} ㎡</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', color: '#666' }}>최대 고저차</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#d32f2f' }}>{diff.toFixed(2)} m</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '15px', marginBottom: '15px', background: '#e3f2fd', padding: '10px', borderRadius: '8px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', color: '#1565c0' }}>용도지역 (토지이용계획)</div>
          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#0d47a1', marginTop: '4px' }}>{zoning}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', color: '#1565c0' }}>인접 도로 현황</div>
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#0d47a1', marginTop: '4px' }}>
            {roads.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: '15px', lineHeight: '1.4' }}>
                {roads.map((r, i) => (
                  <li key={i}>{r.jibun} <span style={{ color: '#d32f2f', fontWeight: 'normal' }}>(폭 4m 미만 시 건축선 후퇴 주의)</span></li>
                ))}
              </ul>
            ) : "직접 인접한 도로(지목 '도')가 없습니다."}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
        <span style={{ fontSize: '12px', color: '#666' }}>도면 줌(확대/축소):</span>
        <input 
          type="range" 
          min="5" 
          max="100" 
          value={zoomPadding} 
          onChange={(e) => setZoomPadding(Number(e.target.value))} 
          style={{ width: '100px', cursor: 'pointer' }}
          title="도면의 여백 스케일을 조절합니다"
        />
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '10px', background: 'white', display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <svg width="100%" height="auto" viewBox="0 0 500 500" style={{ maxWidth: '500px' }}>
          
          {contextPolys.map((poly) => (
            <g key={poly.id}>
              <polygon 
                points={poly.points.map(v => `${v.svgX},${v.svgY}`).join(" ")} 
                fill={getFillColor(poly.type)} 
                stroke="#ccc" 
                strokeWidth="1"
              />
              <text 
                x={poly.centroid.svgX} 
                y={poly.centroid.svgY} 
                fontSize="11" 
                fill="#666" 
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {poly.jibun}
              </text>
            </g>
          ))}

          {targetPolys.map((poly) => (
            <g key={poly.id}>
              <polygon 
                points={poly.points.map(v => `${v.svgX},${v.svgY}`).join(" ")} 
                fill="rgba(66, 133, 244, 0.2)" 
                stroke="#4285F4" 
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <text 
                x={poly.centroid.svgX} 
                y={poly.centroid.svgY} 
                fontSize="14" 
                fontWeight="bold"
                fill="#1565c0" 
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ textShadow: "1px 1px 2px white, -1px -1px 2px white, 1px -1px 2px white, -1px 1px 2px white" }}
              >
                {poly.jibun}
              </text>
            </g>
          ))}
          
          {mappedSunlightLines.map((item, i) => (
              <g key={`sunlight_${i}`}>
                <line 
                  x1={item.pt.svgX} y1={item.pt.svgY} 
                  x2={item.prime.svgX} y2={item.prime.svgY} 
                  stroke="#e65100" strokeWidth="2" strokeDasharray="4 4" 
                />
                <circle cx={item.pt.svgX} cy={item.pt.svgY} r="4" fill="#e65100" />
                <circle cx={item.prime.svgX} cy={item.prime.svgY} r="3" fill="#e65100" />
                
                <text 
                  x={item.pt.svgX - 8} 
                  y={item.pt.svgY - 8} 
                  fontSize="12" 
                  fill="#e65100" 
                  fontWeight="bold"
                  style={{ textShadow: "1px 1px 1px white, -1px -1px 1px white" }}
                >
                  {item.label}
                </text>
                <text 
                  x={item.pt.svgX} 
                  y={item.pt.svgY + 16} 
                  fontSize="11" 
                  fill="#e65100" 
                  textAnchor="middle"
                  fontWeight="bold"
                  style={{ textShadow: "1px 1px 1px white, -1px -1px 1px white" }}
                >
                  {item.z !== undefined ? item.z.toFixed(2) : "0.00"}
                </text>
                
                <text 
                  x={item.prime.svgX + 8} 
                  y={item.prime.svgY - 8} 
                  fontSize="12" 
                  fill="#e65100" 
                  fontWeight="bold"
                  style={{ textShadow: "1px 1px 1px white, -1px -1px 1px white" }}
                >
                  {item.label}'
                </text>
              </g>
          ))}

          {mappedElevations.map((v, i) => (
            <g key={`elv_${i}`}>
              <circle cx={v.svgX} cy={v.svgY} r="3" fill="#d32f2f" />
              <text 
                x={v.svgX} 
                y={(v.svgY || 0) - 8} 
                fontSize="10" 
                fill="#d32f2f" 
                textAnchor="middle"
                fontWeight="bold"
                style={{ textShadow: "1px 1px 1px white, -1px -1px 1px white" }}
              >
                {v.z?.toFixed(2)}
              </text>
            </g>
          ))}

          <g transform="translate(460, 40)">
            <circle cx="0" cy="0" r="16" fill="rgba(255,255,255,0.8)" stroke="#999" strokeWidth="1"/>
            <path d="M-5,7 L0,-9 L5,7 L0,3 Z" fill="#d32f2f" />
            <text x="0" y="-12" fontSize="12" fontWeight="bold" fill="#333" textAnchor="middle">N</text>
          </g>
        </svg>
      </div>

      {northSunlightData.length > 0 && (
        <div style={{ marginTop: '15px', padding: '15px', border: '1px solid #ffcc80', borderRadius: '8px', background: '#fff3e0' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#e65100' }}>☀️ 정북방향 일조권 사선제한 기준 레벨</h4>
          {northSunlightData.map((sd, i) => (
            <div key={i} style={{ marginBottom: '10px', fontSize: '13px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>북측 인접대지: {sd.polyJibun}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ background: 'white', padding: '8px', borderRadius: '4px', border: '1px solid #ffe0b2' }}>
                  <div style={{ color: '#e65100', fontWeight: 'bold', marginBottom: '2px' }}>시작점 ({sd.startLabel} 측)</div>
                  <div>타겟 고도({sd.startLabel}): {sd.A.z?.toFixed(2)}m</div>
                  <div>인접대지 고도({sd.startLabel}'): {sd.Aprime.z?.toFixed(2)}m</div>
                  <div style={{ borderTop: '1px dashed #ccc', marginTop: '4px', paddingTop: '4px', fontWeight: 'bold' }}>
                    기준 레벨: {sd.finalStartLvl.toFixed(2)}m
                  </div>
                </div>
                <div style={{ background: 'white', padding: '8px', borderRadius: '4px', border: '1px solid #ffe0b2' }}>
                  <div style={{ color: '#e65100', fontWeight: 'bold', marginBottom: '2px' }}>끝점 ({sd.endLabel} 측)</div>
                  <div>타겟 고도({sd.endLabel}): {sd.B.z?.toFixed(2)}m</div>
                  <div>인접대지 고도({sd.endLabel}'): {sd.Bprime.z?.toFixed(2)}m</div>
                  <div style={{ borderTop: '1px dashed #ccc', marginTop: '4px', paddingTop: '4px', fontWeight: 'bold' }}>
                    기준 레벨: {sd.finalEndLvl.toFixed(2)}m
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '8px', padding: '6px', background: '#fff', borderRadius: '4px', textAlign: 'center', fontWeight: 'bold', color: '#d32f2f', border: '1px solid #ffcc80' }}>
                해당 경계구간 최종 대표 레벨: {sd.finalAverageLvl.toFixed(2)} m
              </div>
            </div>
          ))}
          <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#e65100', color: 'white', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold', fontSize: '15px' }}>
            북측 일조사선 평균레벨: {northSunlightData[0]?.globalAverageLvl.toFixed(2)} m
          </div>
        </div>
      )}
      
      <div style={{ marginTop: '15px' }}>
        <p style={{ fontSize: '12px', color: '#666', lineHeight: '1.6' }}>
          * <strong>정북(N) 방향</strong>을 기준으로 정렬된 배치도입니다.<br/>
          * <strong>색상 구분</strong>: 도로(회색), 공원(녹색), 농지(노란색), 일반대지(흰색).<br/>
          * 각 필지 중심에 기재된 텍스트는 <strong>본번 및 지목</strong>입니다.<br/>
          * 대상 대지 모서리의 붉은 숫자는 <strong>절점별 해발고도(EL)</strong>입니다.
        </p>
      </div>
    </div>
  );
}
