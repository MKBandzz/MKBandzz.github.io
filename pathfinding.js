// pathfinding.js
// Version: 2.0
// Description: Graph construction and Dijkstra's algorithm for OpenLayers map.
// Features: Time-based cost (Distance/Speed), Oneway support, Nearest eligible node search (excluding Freeways/Ramps).

// This object will store our graph: { "nodeId": { "neighborId": weight (time cost), ... }, ... }
const roadGraph = {};

/**
 * Calculates the Euclidean distance between two coordinates.
 */
function calculateDistance(coord1, coord2) {
    // Distance formula: sqrt( (x2-x1)^2 + (y2-y1)^2 )
    const dx = coord1[0] - coord2[0];
    const dy = coord1[1] - coord2[1];
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates the cost (weight) of traversing a segment of road.
 * The cost is calculated as time (Distance / Speed) in arbitrary units.
 * @param {number} distance - The length of the road segment.
 * @param {number} speed - The speed limit of the road segment.
 * @returns {number} The cost (time) to traverse the segment.
 */
function calculateCost(distance, speed) {
    // If speed is 0 or missing, set a very high cost to prevent usage.
    if (!speed || speed <= 0) {
        return Infinity;
    }
    // Cost = Time = Distance / Speed
    return distance / speed; 
}

/**
 * Extracts and processes road segment attributes to create graph edges.
 * Note: Level checking for intersections is handled by relying on GeoJSON 
 * vertices matching at adjacent levels (e.g., Level 1 connects to Level 2 vertex).
 * @param {Array<ol.Feature>} roadFeatures - The features from the roads GeoJSON.
 * @returns {Object} The constructed adjacency list graph.
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
            
            // Use a string representation of the coordinate as the unique node ID (key)
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
 * Finds the nearest node in the roadGraph that is closest to a clicked coordinate,
 * by first finding the nearest road feature/segment on the map.
 * @param {Array<number>} clickedCoord - The [x, z] coordinate of the user's click (in data projection).
 * @param {ol.source.Vector} roadSource - The OpenLayers Vector Source containing all road features.
 * @param {ol.proj.Projection} dataProjection - The map's data projection ('DATA').
 * @param {ol.proj.Projection} viewProjection - The map's view projection ('VIEW').
 * @returns {string|null} The nodeId (e.g., "120,-350") of the closest graph node, or null.
 */
function findNearestNode(clickedCoord, roadSource, dataProjection, viewProjection) {
    let minDistance = 10; // 10 blocks (user's tolerance)
    let nearestNodeId = null;

    let closestPoint = null;
    
    // Convert the clickedCoord (data projection) to the map's view projection for spatial query
    const transformedClick = ol.proj.transform(clickedCoord, dataProjection, viewProjection);
    
    // Get all features near the clicked point in the view projection
    const features = roadSource.getFeatures();
    
    for (const feature of features) {
        const roadType = feature.get('Type');
        
        // --- Apply the Exclusion Filter ---
        if (roadType === 'Freeway' || roadType === 'Ramp') {
            continue; 
        }

        const geometry = feature.getGeometry();
        // Use OpenLayers' internal function to find the closest point on the geometry to the coordinate
        const closestPointOnFeature = geometry.getClosestPoint(transformedClick);
        
        // Convert the closest point back to the data projection for distance calculation
        const closestPointData = ol.proj.transform(closestPointOnFeature, viewProjection, dataProjection);
        
        // Calculate the distance in the data projection (block units)
        const distance = calculateDistance(clickedCoord, closestPointData);

        if (distance < minDistance) {
            minDistance = distance;
            // This is the point on the road line, not necessarily a graph node
            closestPoint = closestPointData; 
        }
    }

    if (!closestPoint) {
        return null; // Click was too far from an eligible road
    }
    
    // 2. Find the closest *node in the graph* to that point on the road.
    let minNodeDistance = Infinity;
    const allNodeIds = Object.keys(roadGraph);

    for (let nodeId of allNodeIds) {
        const nodeCoord = nodeId.split(',').map(Number);
        const distance = calculateDistance(closestPoint, nodeCoord);

        if (distance < minNodeDistance) {
            minNodeDistance = distance;
            nearestNodeId = nodeId;
        }
    }
    
    return nearestNodeId;
}


// --- Dijkstra's Algorithm and Priority Queue ---
// A simple Priority Queue implementation using Array.sort (slow but functional)

class PriorityQueue {
    constructor() {
        // Stores [cost, nodeId]
        this.values = [];
    }
    enqueue(element) {
        this.values.push(element);
        // Simple O(N log N) sort for cost ordering
        this.values.sort((a, b) => a[0] - b[0]); 
    }
    dequeue() {
        return this.values.shift(); // O(N) removal
    }
    isEmpty() {
        return this.values.length === 0;
    }
}

/**
 * Runs Dijkstra's algorithm from the start node.
 * 
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