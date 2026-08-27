import buffer from '@turf/buffer';

const poly = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [[
      [127.0276, 37.4979],
      [127.0278, 37.4979],
      [127.0278, 37.4981],
      [127.0276, 37.4981],
      [127.0276, 37.4979]
    ]]
  }
};

try {
  const result = buffer(poly, -1, { units: 'meters' });
  console.log(JSON.stringify(result));
} catch(e) {
  console.error("Buffer error:", e);
}
