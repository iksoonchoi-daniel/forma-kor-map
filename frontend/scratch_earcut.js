import earcut from 'earcut';

const flat2D = [0,0, 10,0, 10,10, 0,10];
const topIndices = earcut(flat2D);
console.log(topIndices);
