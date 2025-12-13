// pathfinding.js

// This object will store our graph: { "nodeId": { "neighborId": weight (time cost), ... }, ... }
const roadGraph = {};

/**
 * Calculates the Euclidean distance between two coordinates.
 */
function calculateDistance(coord1, coord2) {
    const dx = coord1[0] - coord2[0];
    const dy = coord1[1] - coord2[1];
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates the cost (weight) of traversing a segment of road (Cost = Time = Distance / Speed).
 */
function calculateCost(distance, speed) {
    if (!speed || speed <= 0) {
        return Infinity;
    }
    return distance / speed; 
}

/**
 * Extracts and processes road segment attributes to create graph edges.
 */
function buildRoadGraph(roadFeatures) {
    console.log("Building road network graph with time and level constraints...");
    
    // Reset the global graph object
    for (const key in roadGraph) { delete roadGraph[key]; }

    roadFeatures.forEach(feature => {
        const geometry = feature.getGeometry();
        if (geometry.getType() !== 'LineString') return;

        const attributes = feature.getProperties();
        const coordinates = geometry.getCoordinates();
        
        const speed = attributes.speed;
        const oneway = attributes.oneway ? String(attributes.oneway).toLowerCase() : 'both';
        
        for (let i = 0; i < coordinates.length - 1; i++) {
            const startCoord = coordinates[i];
            const endCoord = coordinates[i+1];
            
            const startId = startCoord.join(',');
            const endId = endCoord.join(',');
            
            // Calculate distance for the individual segment and convert to cost
            const segmentDistance = calculateDistance(startCoord, endCoord);
            const segmentCost = calculateCost(segmentDistance, speed);


            // --- ONEWAY CHECKING ---

            const isForwardAllowed = oneway === 'both' || oneway === 'forward';
            const isBackwardAllowed = oneway === 'both' || oneway === 'backward';


            // 1. Forward direction: startId -> endId
            if (isForwardAllowed && segmentCost !== Infinity) {
                if (!roadGraph[startId]) roadGraph[startId] = {};
                roadGraph[startId][endId] = segmentCost;
            }
            
            // 2. Backward direction: endId -> startId
            if (isBackwardAllowed && segmentCost !== Infinity) {
                if (!roadGraph[endId]) roadGraph[endId] = {};
                roadGraph[endId][startId] = segmentCost;
            }
        }
    });
    
    console.log(`Graph built with ${Object.keys(roadGraph).length} nodes.`);
    return roadGraph;
}

/**
 * Finds the closest node in the roadGraph to a given coordinate (snaps click to road).
 */
function findNearestNode(coord) {
    let minDistance = Infinity;
    let nearestNodeId = null;
    const allNodeIds = Object.keys(roadGraph);

    if (allNodeIds.length === 0) {
        return null;
    }

    for (let nodeId of allNodeIds) {
        const nodeCoord = nodeId.split(',').map(Number);
        const distance = calculateDistance(coord, nodeCoord);

        if (distance < minDistance) {
            minDistance = distance;
            nearestNodeId = nodeId;
        }
    }

    // Only accept clicks close to a road (adjust 50 to your preference)
    if (minDistance > 50) {
        return null; 
    }
    
    return nearestNodeId;
}


// --- Dijkstra's Algorithm and Priority Queue ---

class PriorityQueue {
    constructor() {
        this.values = [];
    }
    enqueue(element) {
        this.values.push(element);
        this.values.sort((a, b) => a[0] - b[0]); 
    }
    dequeue() {
        return this.values.shift();
    }
    isEmpty() {
        return this.values.length === 0;
    }
}

/**
 * Runs Dijkstra's algorithm from the start node.
 */
function dijkstra(startNodeId) {
    const distances = {};
    const previous = {};
    const pq = new PriorityQueue(); 
    
    for (let node in roadGraph) {
        distances[node] = Infinity;
        previous[node] = null;
    }
    distances[startNodeId] = 0;
    
    pq.enqueue([0, startNodeId]); 

    while (!pq.isEmpty()) {
        const [currentCost, currentNodeId] = pq.dequeue();

        if (currentCost > distances[currentNodeId]) continue;

        const neighbors = roadGraph[currentNodeId];
        
        for (let neighborId in neighbors) {
            const travelCost = neighbors[neighborId];
            const newCost = currentCost + travelCost;
            
            if (newCost < distances[neighborId]) {
                distances[neighborId] = newCost;
                previous[neighborId] = currentNodeId;
                pq.enqueue([newCost, neighborId]);
            }
        }
    }
    
    return { distances, previous };
}

/**
 * Reconstructs the shortest path from the result of the Dijkstra's algorithm.
 */
function reconstructPath(endNodeId, previous) {
    const path = [];
    let currentNode = endNodeId;
    
    while (currentNode) {
        const coord = currentNode.split(',').map(Number);
        path.unshift(coord); 
        currentNode = previous[currentNode];
    }
    
    return path; 
}


/**
 * External function to be called from index.html to execute pathfinding.
 */
function calculatePath(startId, endId) {
    if (!startId || !endId) {
        return { path: null, totalCost: Infinity, message: "Start or End node missing." };
    }

    const result = dijkstra(startId);
    
    if (result.distances[endId] === Infinity) {
        return { path: null, totalCost: Infinity, message: "End point is unreachable from start point." };
    }

    const path = reconstructPath(endId, result.previous);
    const totalCost = result.distances[endId];
    
    return { path, totalCost };
}