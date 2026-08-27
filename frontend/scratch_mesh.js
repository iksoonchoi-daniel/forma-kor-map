import earcut from 'earcut';

function extrudePolygon(ring, height) {
    const N = ring.length - 1;
    const vertices = new Float32Array(N * 2 * 3);
    const flat2D = [];
    
    for (let i = 0; i < N; i++) {
        const x = ring[i][0];
        const y = ring[i][1];
        flat2D.push(x, y);
        
        vertices[i * 3] = x;
        vertices[i * 3 + 1] = y;
        vertices[i * 3 + 2] = 0;
        
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
    
    for (let i = 0; i < topIndices.length; i += 3) {
        indices[idx++] = topIndices[i] + N;
        indices[idx++] = topIndices[i+1] + N;
        indices[idx++] = topIndices[i+2] + N;
    }
    
    for (let i = 0; i < topIndices.length; i += 3) {
        indices[idx++] = topIndices[i+2];
        indices[idx++] = topIndices[i+1];
        indices[idx++] = topIndices[i];
    }
    
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

const ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0]
];

const result = extrudePolygon(ring, 5);
console.log(result);
