const EARTH_RADIUS = 6371000; // in meters

/**
 * Converts a WGS84 coordinate to local coordinates in meters relative to a reference point.
 * @param refLon Reference longitude
 * @param refLat Reference latitude
 * @param lon Target longitude
 * @param lat Target latitude
 * @returns [x, y] in meters
 */
export function wgs84ToLocalMeters(refLon: number, refLat: number, lon: number, lat: number): [number, number] {
    const latRad = lat * (Math.PI / 180);
    const lonRad = lon * (Math.PI / 180);
    const refLatRad = refLat * (Math.PI / 180);
    const refLonRad = refLon * (Math.PI / 180);

    const x = EARTH_RADIUS * (lonRad - refLonRad) * Math.cos(refLatRad);
    const y = EARTH_RADIUS * (latRad - refLatRad);

    return [x, y];
}

/**
 * Converts a GeoJSON Polygon coordinates to Forma local footprint.
 */
export function convertPolygonToFootprint(
    polygonCoords: number[][][], 
    refLon: number, 
    refLat: number
): number[][][] {
    return polygonCoords.map(ring => 
        ring.map(coord => {
            const [x, y] = wgs84ToLocalMeters(refLon, refLat, coord[0], coord[1]);
            // Depending on Forma's coordinate system, we might need to adjust X, Y 
            // but standard is [x, y] where x is east, y is north.
            return [x, y];
        })
    );
}
