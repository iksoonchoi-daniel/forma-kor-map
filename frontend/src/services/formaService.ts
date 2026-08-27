import { Forma } from "forma-embedded-view-sdk/auto";

export async function getProjectLocation() {
    const location = await Forma.project.getGeoLocation();
    return location;
}

export async function getExistingJibuns(): Promise<Set<string>> {
    const existingJibuns = new Set<string>();
    try {
        const { Forma } = await import("forma-embedded-view-sdk/auto");
        const rootUrn = await Forma.proposal.getRootUrn();
        const { elements: allElements } = await Forma.elements.get({ urn: rootUrn, recursive: true });
        for (const el of Object.values(allElements)) {
            const name = (el as any).properties?.name;
            if (name && name !== "Cadastre") {
                existingJibuns.add(name);
            }
            if ((el as any).properties?.category === "site_limit") {
                console.log("[DEBUG] Native site_limit found:", JSON.stringify(el, null, 2));
            }
        }
    } catch (e) {
        console.warn("중복 체크를 위한 기존 폴리곤 조회를 실패했습니다.", e);
    }
    return existingJibuns;
}

export async function addSiteLimitElements(features: any[], refLon: number, refLat: number, category: string = "site_limit"): Promise<string[]> {
    const { wgs84ToLocalMeters } = await import("./coordTransform");
    const { Forma } = await import("forma-embedded-view-sdk/auto");
    const existingJibuns = await getExistingJibuns();

    const geoJsonFeatures = features
        .filter(feature => {
            const jibun = feature.properties?.jibun || feature.properties?.addr;
            return !jibun || !existingJibuns.has(jibun);
        })
        .map(feature => {
            let footprint: [number, number][][] = [];

            if (feature.geometry.type === "Polygon") {
                footprint = feature.geometry.coordinates.map((ring: number[][]) => {
                    const newRing = ring.map((coord: number[]) => {
                        const [x, y] = wgs84ToLocalMeters(refLon, refLat, coord[0], coord[1]);
                        return [x, y];
                    });
                    
                    let sum = 0;
                    for (let i = 0; i < newRing.length - 1; i++) {
                        sum += (newRing[i+1][0] - newRing[i][0]) * (newRing[i+1][1] + newRing[i][1]);
                    }
                    if (sum > 0) {
                        newRing.reverse();
                    }
                    return newRing;
                });
            } else if (feature.geometry.type === "MultiPolygon") {
                footprint = feature.geometry.coordinates[0].map((ring: number[][]) => {
                    const newRing = ring.map((coord: number[]) => {
                        const [x, y] = wgs84ToLocalMeters(refLon, refLat, coord[0], coord[1]);
                        return [x, y];
                    });
                    
                    let sum = 0;
                    for (let i = 0; i < newRing.length - 1; i++) {
                        sum += (newRing[i+1][0] - newRing[i][0]) * (newRing[i+1][1] + newRing[i][1]);
                    }
                    if (sum > 0) {
                        newRing.reverse();
                    }
                    return newRing;
                });
            }

            const elementId = crypto.randomUUID();
            
            return {
                elementId,
                featureId: elementId,
                properties: feature.properties,
                geoJsonFeature: {
                    id: elementId,
                    type: "Feature",
                    geometry: {
                        type: "Polygon",
                        coordinates: footprint
                    },
                    properties: {
                        stroke: {
                            color: "#4285F4",
                            lineWidth: 1.0
                        },
                        fill: {
                            color: "#4285F4",
                            opacity: 0.05
                        }
                    }
                }
            };
        });

    if (geoJsonFeatures.length === 0) return [];

    const geoJsonData = {
        type: "FeatureCollection",
        features: geoJsonFeatures.map(f => f.geoJsonFeature)
    };

    const uploadResult = await Forma.integrateElements.uploadFile({
        data: JSON.stringify(geoJsonData)
    });

    const batchItems = geoJsonFeatures.map(f => {
        return {
            operation: "create" as const,
            properties: {
                name: f.properties?.jibun || f.properties?.addr || "Cadastre",
                category: category,
                virtual: category !== "site_limit",
                formaKorMapElementId: f.featureId,
            },
            representations: {
                footprint: {
                    type: "linked" as const,
                    blobId: uploadResult.blobId,
                    selection: {
                        type: "equals" as const,
                        value: f.featureId
                    }
                },
                surface: {
                    type: "linked" as const,
                    blobId: uploadResult.blobId,
                    selection: {
                        type: "equals" as const,
                        value: f.featureId
                    }
                },
                terrainShape: {
                    type: "linked" as const,
                    blobId: uploadResult.blobId,
                    selection: {
                        type: "equals" as const,
                        value: f.featureId
                    }
                },
            }
        };
    });

    if (batchItems.length > 0) {
        try {
            const result = await Forma.integrateElements.batchIngestElementsV2({
                items: batchItems
            });

            for (let i = 0; i < result.items.length; i++) {
                const item = result.items[i];
                if (item.status === "ok") {
                    const elementName = batchItems[i].properties.name;
                    await Forma.proposal.addElement({ urn: item.urn, name: elementName });
                } else {
                    console.error("Item failed in batch:", JSON.stringify(item.error, null, 2));
                }
            }
        } catch (err) {
            console.error("Batch ingest threw an exception:", err);
            throw err;
        }
    }
    
    return geoJsonFeatures.map(f => f.featureId);
}

function extrudePolygon(earcut: any, ring: [number, number][], height: number) {
    const N = ring.length - 1; // Assuming closed ring
    const vertices = new Float32Array(N * 2 * 3);
    const flat2D = [];
    
    for (let i = 0; i < N; i++) {
        const x = ring[i][0];
        const y = ring[i][1];
        flat2D.push(x, y);
        
        // Bottom vertex
        vertices[i * 3] = x;
        vertices[i * 3 + 1] = y;
        vertices[i * 3 + 2] = 0;
        
        // Top vertex
        vertices[(i + N) * 3] = x;
        vertices[(i + N) * 3 + 1] = y;
        vertices[(i + N) * 3 + 2] = height;
    }
    
    const topIndices = earcut(flat2D);
    const numTriangles = topIndices.length / 3;
    const wallTriangles = N * 2;
    const totalTriangles = numTriangles * 2 + wallTriangles;
    const indices = new Uint32Array(totalTriangles * 3);
    
    let idx = 0;
    
    // Top face
    for (let i = 0; i < topIndices.length; i += 3) {
        indices[idx++] = topIndices[i] + N;
        indices[idx++] = topIndices[i+1] + N;
        indices[idx++] = topIndices[i+2] + N;
    }
    
    // Bottom face (reversed)
    for (let i = 0; i < topIndices.length; i += 3) {
        indices[idx++] = topIndices[i+2];
        indices[idx++] = topIndices[i+1];
        indices[idx++] = topIndices[i];
    }
    
    // Walls
    for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        indices[idx++] = i;
        indices[idx++] = j;
        indices[idx++] = j + N;
        indices[idx++] = i;
        indices[idx++] = j + N;
        indices[idx++] = i + N;
    }
    
    return {
        verts: Array.from(vertices),
        faces: Array.from(indices)
    };
}

export async function addEnvelopeElements(features: any[], refLon: number, refLat: number, bcr: number, far: number, setback: number, floorHeight: number): Promise<{ elementIds: string[], metrics: any }> {
    const { wgs84ToLocalMeters } = await import("./coordTransform");
    const { Forma } = await import("forma-embedded-view-sdk/auto");
    const buffer = (await import("@turf/buffer")).default;
    const area = (await import("@turf/area")).default;
    const earcut = (await import("earcut")).default;

    const maxHeight = (far / bcr) * floorHeight;
    const geoJsonFeatures = [];

    let totalSiteArea = 0;
    let totalFootprintArea = 0;

    for (const feature of features) {
        totalSiteArea += area(feature);
        
        let bufferedFeature = feature;
        if (setback > 0) {
            try {
                // turf buffer accepts negative for inward
                bufferedFeature = buffer(feature, -(setback / 100000), { units: 'degrees' }); 
                // Wait! feature is in EPSG:4326 (degrees), buffer with {units: 'meters'} is supported! 
                // Wait! Turf buffer with units: 'meters' works directly on WGS84 GeoJSON!
                bufferedFeature = buffer(feature, -setback, { units: 'meters' });
                if (!bufferedFeature) continue;
            } catch (e) {
                console.warn("Buffer failed", e);
            }
        }
        
        if (bufferedFeature) {
            totalFootprintArea += area(bufferedFeature);
        }

        let footprint: [number, number][][] = [];

        if (bufferedFeature.geometry.type === "Polygon") {
            footprint = bufferedFeature.geometry.coordinates.map((ring: number[][]) => {
                const newRing = ring.map((coord: number[]) => {
                    const [x, y] = wgs84ToLocalMeters(refLon, refLat, coord[0], coord[1]);
                    return [x, y];
                });
                let sum = 0;
                for (let i = 0; i < newRing.length - 1; i++) {
                    sum += (newRing[i+1][0] - newRing[i][0]) * (newRing[i+1][1] + newRing[i][1]);
                }
                if (sum > 0) newRing.reverse();
                return newRing;
            });
        } else if (bufferedFeature.geometry.type === "MultiPolygon") {
            footprint = bufferedFeature.geometry.coordinates[0].map((ring: number[][]) => {
                const newRing = ring.map((coord: number[]) => {
                    const [x, y] = wgs84ToLocalMeters(refLon, refLat, coord[0], coord[1]);
                    return [x, y];
                });
                let sum = 0;
                for (let i = 0; i < newRing.length - 1; i++) {
                    sum += (newRing[i+1][0] - newRing[i][0]) * (newRing[i+1][1] + newRing[i][1]);
                }
                if (sum > 0) newRing.reverse();
                return newRing;
            });
        }

        const elementId = crypto.randomUUID();
        
        let meshData = null;
        try {
            if (footprint.length > 0) {
                meshData = extrudePolygon(earcut, footprint[0], maxHeight);
            }
        } catch (e) {
            console.warn("Mesh extrusion failed", e);
        }
        
        geoJsonFeatures.push({
            elementId,
            featureId: elementId,
            properties: feature.properties,
            meshData, // Storing mesh data here!
            geoJsonFeature: {
                id: elementId,
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: footprint
                },
                properties: {
                    buildingHeight: maxHeight,
                    height: maxHeight,
                    extrusionHeight: maxHeight,
                    color: "#ffca28"
                }
            }
        });
    }

    if (geoJsonFeatures.length === 0) return { elementIds: [], metrics: null };

    const geoJsonData = {
        type: "FeatureCollection",
        features: geoJsonFeatures.map(f => f.geoJsonFeature)
    };

    const project = await Forma.project.get();
    const uploadResult = await Forma.integrateElements.uploadFile({
        authcontext: (project as any).urn,
        data: JSON.stringify(geoJsonData)
    });

    console.log("[DEBUG] Starting batchIngestElementsV2 with footprint only, features:", geoJsonFeatures.length);

    const batchItems = await Promise.all(geoJsonFeatures.map(async f => {
        let meshBlobId: string | undefined = undefined;
        if (f.meshData) {
            const meshJsonStr = JSON.stringify({
                type: "Inline",
                format: "Mesh",
                doubleSided: true,
                verts: f.meshData.verts,
                faces: f.meshData.faces
            });
            try {
                const meshUpload = await Forma.integrateElements.uploadFile({
                    authcontext: (project as any).urn,
                    data: meshJsonStr
                });
                meshBlobId = meshUpload.blobId;
            } catch (e) {
                console.error("Failed to upload mesh JSON", e);
            }
        }

        return {
            operation: "create" as const,
            properties: {
                name: "3D Envelope (건축한계선)",
                category: "generic_building",
                buildingHeight: maxHeight,
                height: maxHeight
            },
            representations: {
                footprint: {
                    type: "linked" as const,
                    blobId: uploadResult.blobId,
                    selection: {
                        type: "equals" as const,
                        value: f.featureId
                    }
                },
                terrainShape: {
                    type: "linked" as const,
                    blobId: uploadResult.blobId,
                    selection: {
                        type: "equals" as const,
                        value: f.featureId
                    }
                },
                ...(meshBlobId ? {
                    volumeMesh: {
                        type: "linked" as const,
                        blobId: meshBlobId
                    }
                } : {})
            }
        };
    }));

    console.log("[DEBUG] batchItems payload:", JSON.stringify(batchItems, null, 2));

    const elementIds = [];
    if (batchItems.length > 0) {
        try {
            console.log("[DEBUG] Calling Forma.integrateElements.batchIngestElementsV2...");
            const result = await Forma.integrateElements.batchIngestElementsV2({
                items: batchItems
            });
            console.log("[DEBUG] batchIngestElementsV2 result:", result);

            for (let i = 0; i < result.items.length; i++) {
                const item = result.items[i];
                console.log(`[DEBUG] Item ${i} status:`, item.status);
                if (item.status === "ok") {
                    console.log(`[DEBUG] Adding element to proposal with urn:`, item.urn);
                    await Forma.proposal.addElement({ urn: item.urn, name: batchItems[i].properties.name });
                    elementIds.push(item.urn);
                } else {
                    console.error("[DEBUG] Item failed in batch:", JSON.stringify(item.error, null, 2));
                    alert(`요소 생성 실패: ${(item.error as any)?.code || 'Unknown Error'}`);
                }
            }
        } catch (err: any) {
            console.error("[DEBUG] Batch ingest threw an exception:", err);
            alert(`API 호출 중 예외 발생: ${err.message || err}`);
        }
    }
    
    const metrics = {
        siteArea: totalSiteArea,
        footprintArea: totalFootprintArea,
        maxHeight: maxHeight,
        floors: Math.floor(far / bcr),
        projectedGfa: totalFootprintArea * Math.floor(far / bcr)
    };

    console.log("[DEBUG] Finished addEnvelopeElements. Returned elementIds:", elementIds, "Metrics:", metrics);
    return { elementIds, metrics };
}
