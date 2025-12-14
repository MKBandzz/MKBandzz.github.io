// ====================================================================
// GLOBAL ROAD GRAPH DATA STRUCTURE
// ====================================================================

/**
 * Stores the road network as an adjacency list.
 * Key: Node ID string "x,z"
 * Value: Object { 
 * x: number, 
 * z: number, 
 * neighbors: Array<{
 * id: string, 
 * cost: number, 
 * distance: number 
 * }> 
 * }
 */
let roadGraph = {};


// ====================================================================
// CORE UTILITY FUNCTIONS (Must be defined globally)
// ====================================================================

/**
 * Calculates the Euclidean (straight-line) distance between two 2D coordinates [x, z].
 * This fixes the 'calculateDistance is not defined' error.
 * @param {Array<number>} coord1 - [x, z] coordinates of the first point.
 * @param {Array<number>} coord2 - [x, z] coordinates of the second point.
 * @returns {number} The straight-line distance in blocks.
 */
function calculateDistance(coord1, coord2) {
    const dx = coord1[0] - coord2[0];
    const dz = coord1[1] - coord2[1];
    return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Builds the road network graph from GeoJSON features.
 * This should be called once the roads.geojson file is loaded.
 * @param {Array<ol.Feature>} features - OpenLayers features from roads.geojson.
 */
function buildRoadGraph(features) {
    console.log("Building road graph...");
    roadGraph = {}; 
    const nodeCoords = new Map(); // Stores "x,z" -> [x, z]

    features.forEach(feature => {
        const geometry = feature.getGeometry();
        if (geometry.getType() === 'LineString') {
            // NOTE: The coordinates here are already in the correct data projection [x, -z] (block coords) due to the logic in index.html
            const coords = geometry.getCoordinates(); 

            for (let i = 0; i < coords.length - 1; i++) {
                const startCoord = coords[i];
                const endCoord = coords[i+1];

                // Convert to Node IDs (which should be rounded integer strings)
                const startNodeId = `${Math.round(startCoord[0])},${Math.round(startCoord[1])}`;
                const endNodeId = `${Math.round(endCoord[0])},${Math.round(endCoord[1])}`;
                
                // Calculate segment distance and cost
                const dist = calculateDistance(startCoord, endCoord);
                const cost = dist; // Simplistic cost: 1 unit per block

                // Initialize nodes if they don't exist
                if (!roadGraph[startNodeId]) {
                    roadGraph[startNodeId] = { x: startCoord[0], z: startCoord[1], neighbors: [] };
                    nodeCoords.set(startNodeId, startCoord);
                }
                if (!roadGraph[endNodeId]) {
                    roadGraph[endNodeId] = { x: endCoord[0], z: endCoord[1], neighbors: [] };
                    nodeCoords.set(endNodeId, endCoord);
                }

                // Add neighbors (bidirectional graph for roads)
                // Filter out adding a neighbor to itself, just in case of duplicated coordinates
                if (startNodeId !== endNodeId) {
                    // Check if the neighbor link already exists to prevent duplication
                    const startHasEnd = roadGraph[startNodeId].neighbors.some(n => n.id === endNodeId);
                    if (!startHasEnd) {
                        roadGraph[startNodeId].neighbors.push({ id: endNodeId, cost: cost, distance: dist });
                    }
                    
                    const endHasStart = roadGraph[endNodeId].neighbors.some(n => n.id === startNodeId);
                    if (!endHasStart) {
                         roadGraph[endNodeId].neighbors.push({ id: startNodeId, cost: cost, distance: dist });
                    }
                }
            }
        }
    });

    console.log(`Road graph built with ${Object.keys(roadGraph).length} nodes.`);
}


/**
 * Finds the nearest road node to a given click coordinate.
 * @param {Array<number>} preciseBlockCoord - The rounded [x, z] block coordinates of the click.
 * @param {ol.source.Vector} roadLayerSource - The source of the road layer features.
 * @param {ol.proj.Projection} dataProjection - The map's data projection (e.g., 'DATA').
 * @param {ol.proj.Projection} viewProjection - The map's view projection (e.g., 'VIEW').
 * @returns {string|null} The ID of the nearest node ("x,z") or null if none found.
 */
function findNearestNode(preciseBlockCoord, roadLayerSource, dataProjection, viewProjection) {
    if (!roadLayerSource) {
        console.error("Road layer source not available for nearest node search.");
        return null;
    }
    
    // Ensure the graph is built
    if (Object.keys(roadGraph).length === 0) {
        console.warn("Road graph is empty. Cannot find nearest node.");
        return null;
    }

    const MAX_DISTANCE_BLOCKS = 10;
    let nearestNodeId = null;
    let minDistance = Infinity;
    const clickCoord = preciseBlockCoord; // [x, z] in data projection

    // Iterate through all nodes in the *built graph* (which is much faster)
    for (const nodeId in roadGraph) {
        const node = roadGraph[nodeId];
        const nodeCoord = [node.x, node.z];

        const distance = calculateDistance(clickCoord, nodeCoord);
        
        if (distance < minDistance && distance <= MAX_DISTANCE_BLOCKS) {
            minDistance = distance;
            nearestNodeId = nodeId;
        }
    }

    if (nearestNodeId) {
        console.log(`Nearest node found: ${nearestNodeId} at distance ${minDistance.toFixed(2)} blocks.`);
    }

    return nearestNodeId;
}


// ====================================================================
// PATHFINDING ALGORITHM (A*)
// ====================================================================

/**
 * Calculates the shortest path between two nodes using the A* algorithm.
 * @param {string} startNodeId - The ID of the starting node ("x,z").
 * @param {string} endNodeId - The ID of the ending node ("x,z").
 * @returns {object} { path: Array<Array<number>>, totalCost: number, message: string }
 */
function calculatePath(startNodeId, endNodeId) {
    if (!roadGraph[startNodeId] || !roadGraph[endNodeId]) {
        console.error("Start or End node not found in the road graph.");
        return { path: [], totalCost: 0, message: "Error: Start or End point is not a valid graph node." };
    }
    
    // Convert end node ID to coordinate for heuristic calculation
    const endCoord = [roadGraph[endNodeId].x, roadGraph[endNodeId].z];

    // Simple Priority Queue implementation helper
    const openSet = [{ id: startNodeId, fScore: 0 }]; 
    
    const gScore = { [startNodeId]: 0 }; // Cost from start to current node
    const fScore = { [startNodeId]: calculateDistance([roadGraph[startNodeId].x, roadGraph[startNodeId].z], endCoord) }; // Estimated total cost
    const cameFrom = {}; // To reconstruct path

    // A* algorithm core logic
    while (openSet.length > 0) {
        // Find node with lowest fScore (Simulating Priority Queue behavior)
        openSet.sort((a, b) => a.fScore - b.fScore);
        const current = openSet.shift();
        const currentId = current.id;
        
        if (currentId === endNodeId) {
            // Path found! Reconstruct and return.
            const path = [];
            let tempId = endNodeId;
            while (tempId) {
                const node = roadGraph[tempId];
                // The coordinates stored are the [x, z] block coordinates
                path.push([node.x, node.z]);
                tempId = cameFrom[tempId];
            }
            // The path array is built backwards, so reverse it
            const finalPath = path.reverse();
            return { 
                path: finalPath, 
                totalCost: gScore[endNodeId], 
                message: "Route found." 
            };
        }

        const currentNode = roadGraph[currentId];
        
        // Process neighbors
        for (const neighbor of currentNode.neighbors) {
            const tentativeGScore = gScore[currentId] + neighbor.cost;
            const neighborId = neighbor.id;

            // If a shorter path to neighbor is found
            if (tentativeGScore < (gScore[neighborId] || Infinity)) {
                
                // This path is the best one so far. Record it.
                cameFrom[neighborId] = currentId;
                gScore[neighborId] = tentativeGScore;

                // Calculate the heuristic (H) using straight-line distance
                const neighborCoord = [roadGraph[neighborId].x, roadGraph[neighborId].z];
                const heuristic = calculateDistance(neighborCoord, endCoord);
                
                // F = G + H
                fScore[neighborId] = tentativeGScore + heuristic;
                
                // Check if neighbor is already in openSet
                const existingIndex = openSet.findIndex(item => item.id === neighborId);
                if (existingIndex === -1) {
                    openSet.push({ id: neighborId, fScore: fScore[neighborId] });
                } else {
                    openSet[existingIndex].fScore = fScore[neighborId];
                }
            }
        }
    }

    // If the loop finishes without finding the end node
    return { path: [], totalCost: 0, message: "Error: Could not find a path between the selected points." };
}