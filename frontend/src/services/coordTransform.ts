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
 * Converts local coordinates in meters back to WGS84 coordinates.
 * @param refLon Reference longitude
 * @param refLat Reference latitude
 * @param x Target x in local meters
 * @param y Target y in local meters
 * @returns [lon, lat]
 */
export function localMetersToWgs84(refLon: number, refLat: number, x: number, y: number): [number, number] {
    const refLatRad = refLat * (Math.PI / 180);
    const refLonRad = refLon * (Math.PI / 180);

    const latRad = (y / EARTH_RADIUS) + refLatRad;
    const lonRad = (x / (EARTH_RADIUS * Math.cos(refLatRad))) + refLonRad;

    const lat = latRad * (180 / Math.PI);
    const lon = lonRad * (180 / Math.PI);

    return [lon, lat];
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
