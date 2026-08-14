import { Forma } from "forma-embedded-view-sdk/auto";

export async function getProjectLocation() {
    const location = await Forma.project.getGeoLocation();
    return location;
}

export async function addSiteLimitElements(features: any[], refLon: number, refLat: number, category: string = "site_limit") {
    const { wgs84ToLocalMeters } = await import("./coordTransform");

    const geoJsonFeatures = features.map(feature => {
        let footprint: [number, number][][] = [];

        if (feature.geometry.type === "Polygon") {
            footprint = feature.geometry.coordinates.map((ring: number[][]) => {
                const newRing = ring.map((coord: number[]) => {
                    const [x, y] = wgs84ToLocalMeters(refLon, refLat, coord[0], coord[1]);
                    return [x, y];
                });
                
                // Enforce counter-clockwise winding order (required by Forma/GeoJSON)
                let sum = 0;
                for (let i = 0; i < newRing.length - 1; i++) {
                    sum += (newRing[i+1][0] - newRing[i][0]) * (newRing[i+1][1] + newRing[i][1]);
                }
                if (sum > 0) {
                    newRing.reverse(); // reverse if clockwise
                }
                return newRing;
            });
        } else if (feature.geometry.type === "MultiPolygon") {
            // Take the first polygon for simplicity
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
                    newRing.reverse(); // reverse if clockwise
                }
                return newRing;
            });
        }

        const elementId = feature.properties?.jibun ? `cadastre-${feature.properties.jibun}` : crypto.randomUUID();
        
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
                properties: {}
            }
        };
    });

    if (geoJsonFeatures.length === 0) return;

    const geoJsonData = {
        type: "FeatureCollection",
        features: geoJsonFeatures.map(f => f.geoJsonFeature)
    };

    // Upload the combined GeoJSON file ONCE
    const uploadResult = await Forma.integrateElements.uploadFile({
        data: JSON.stringify(geoJsonData)
    });

    const batchItems = geoJsonFeatures.map(f => {
        return {
            operation: "create" as const,
            properties: {
                name: f.properties?.jibun || f.properties?.addr || "Cadastre",
                category: category,
                virtual: category !== "site_limit", // IMPORTANT: Must be false for site_limit to enable area analysis
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
        console.log("Adding elements payload:", JSON.stringify(batchItems, null, 2));
        
        try {
            const result = await Forma.integrateElements.batchIngestElementsV2({
                items: batchItems
            });

            console.log("Batch ingest result:", JSON.stringify(result, null, 2));

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
}
