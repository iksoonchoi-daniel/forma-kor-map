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
                    type: "linked",
                    blobId: uploadResult.blobId,
                    selection: {
                        type: "equals",
                        value: f.featureId
                    }
                },
                terrainShape: {
                    type: "linked",
                    blobId: uploadResult.blobId,
                    selection: {
                        type: "equals",
                        value: f.featureId
                    }
                }
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
