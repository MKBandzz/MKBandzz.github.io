// ====================================================================
// GLOBAL ROAD GRAPH DATA STRUCTURE
// ====================================================================

/**
 * Stores the road network as an adjacency list.
 * Key: Node ID string "x,z"
 * Value: Object { 
 * x: number, // Rounded integer coordinate (for matching node ID)
 * z: number, // Rounded integer coordinate (for matching node ID)
 * neighbors: Array<{
 * id: string, 
 * cost: number, 
 * distance: number 
 * }> 
 * }
 */
let roadGraph = {};


// ====================================================================
// CORE UTILITY FUNCTIONS
// ====================================================================

/**
 * Calculates the Euclidean (straight-line) distance between two 2D coordinates [x, z].
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
 * Finds the nearest road node to a given click coordinate.
 * This is the function responsible for converting a click into a usable node ID.
 * @param {Array<number>} targetCoord - [x, z] coordinates of the clicked location (Minecraft blocks, high-precision float).
 * @returns {string|null} The ID of the nearest node (e.g., "123,456") or null.
 */
function findNearestNode(targetCoord) {
    // *** FIX: Increased Search Radius to 30 Blocks for more forgiving clicks ***
    const MAX_DISTANCE = 30; // Search radius in blocks
    let nearestNodeId = null;
    let minDistance = Infinity;
    
    // --- DEBUG: Log the received target coordinate ---
    console.log(`findNearestNode called with target: [${targetCoord[0].toFixed(3)}, ${targetCoord[1].toFixed(3)}]`);

    // Iterate over all nodes in the road graph
    for (const nodeId in roadGraph) {
        const node = roadGraph[nodeId];
        
        // Node coordinates are the rounded integer coordinates from buildRoadGraph
        const nodeCoord = [node.x, node.z]; 

        // Calculate distance between the precise click coordinate and the integer node coordinate
        const distance = calculateDistance(nodeCoord, targetCoord);

        if (distance < minDistance && distance <= MAX_DISTANCE) {
            minDistance = distance;
            nearestNodeId = nodeId;
        }
    }
    
    // --- FINAL DEBUG: Log the result ---
    if (nearestNodeId) {
        console.log(`Success: Nearest node found: ${nearestNodeId} (Distance: ${minDistance.toFixed(3)})`);
    } else {
        console.log(`Failure: No road node found within ${MAX_DISTANCE} blocks.`);
    }

    return nearestNodeId;
}


/**
 * Builds the road network graph from GeoJSON features.
 * Features are guaranteed by index.html to be in raw Minecraft block [X, Z] coordinates.
 * @param {Array<ol.Feature>} features - OpenLayers features from roads.geojson.
 */
function buildRoadGraph(features) {
    console.log("Building road graph...");
    roadGraph = {}; 
    
    features.forEach(feature => {
        const geometry = feature.getGeometry();
        if (geometry.getType() === 'LineString') {
            // Coords are [X, Z] (Minecraft blocks)
            const coords = geometry.getCoordinates(); 

            for (let i = 0; i < coords.length - 1; i++) {
                const startCoord = coords[i];
                const endCoord = coords[i+1];

                // Node IDs are based on the rounded integer coordinates
                const startNodeId = `${Math.round(startCoord[0])},${Math.round(startCoord[1])}`;
                const endNodeId = `${Math.round(endCoord[0])},${Math.round(endCoord[1])}`;
                
                // Calculate segment distance and cost
                const dist = calculateDistance(startCoord, endCoord);
                const cost = dist; 

                // --- Node Initialization ---
                if (!roadGraph[startNodeId]) {
                    // Store the rounded integer coordinates for quick access and consistent node ID matching
                    roadGraph[startNodeId] = { 
                        x: Math.round(startCoord[0]), 
                        z: Math.round(startCoord[1]), 
                        neighbors: [] 
                    };
                }
                if (!roadGraph[endNodeId]) {
                    // Store the rounded integer coordinates for quick access
                    roadGraph[endNodeId] = { 
                        x: Math.round(endCoord[0]), 
                        z: Math.round(endCoord[1]), 
                        neighbors: [] 
                    };
                }

                // Add neighbors (bidirectional graph for roads)
                if (startNodeId !== endNodeId) {
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
 * Reconstructs the path from the cameFrom map.
 */
function reconstructPath(cameFrom, currentId) {
    const path = [];
    while (currentId) {
        const node = roadGraph[currentId];
        path.push([node.x, node.z]);
        currentId = cameFrom[currentId];
    }
    return path.reverse();
}

/**
 * Finds the shortest path between two road nodes using the A* algorithm.
 */
function calculatePath(startNodeId, endNodeId) {
    if (!roadGraph[startNodeId] || !roadGraph[endNodeId]) {
        return { path: [], totalCost: 0, distance: 0, message: "Error: Start or end node not found in the road graph." };
    }

    const cameFrom = {}; 
    const gScore = {}; 
    gScore[startNodeId] = 0;
    
    const fScore = {};
    const endNode = roadGraph[endNodeId];
    const endCoord = [endNode.x, endNode.z]; 
    fScore[startNodeId] = calculateDistance([roadGraph[startNodeId].x, roadGraph[startNodeId].z], endCoord);

    const openSet = [{ id: startNodeId, fScore: fScore[startNodeId] }];

    while (openSet.length > 0) {
        
        openSet.sort((a, b) => a.fScore - b.fScore);
        const current = openSet.shift(); 
        const currentId = current.id;

        if (currentId === endNodeId) {
            const finalPath = reconstructPath(cameFrom, currentId);
            let totalDistance = 0;
            
            // Calculate actual distance in blocks
            for(let i = 0; i < finalPath.length - 1; i++) {
                totalDistance += calculateDistance(finalPath[i], finalPath[i+1]);
            }

            return { 
                path: finalPath, 
                totalCost: gScore[endNodeId], 
                distance: totalDistance, 
                message: "Route found." 
            };
        }

        const currentNode = roadGraph[currentId];
        
        for (const neighbor of currentNode.neighbors) {
            const tentativeGScore = gScore[currentId] + neighbor.cost;
            const neighborId = neighbor.id;

            if (tentativeGScore < (gScore[neighborId] || Infinity)) {
                
                cameFrom[neighborId] = currentId;
                gScore[neighborId] = tentativeGScore;

                const neighborCoord = [roadGraph[neighborId].x, roadGraph[neighborId].z];
                const heuristic = calculateDistance(neighborCoord, endCoord);
                
                fScore[neighborId] = tentativeGScore + heuristic;
                
                const existing = openSet.find(item => item.id === neighborId);
                if (!existing) {
                    openSet.push({ id: neighborId, fScore: fScore[neighborId] });
                } else {
                    existing.fScore = fScore[neighborId];
                }
            }
        }
    }

    return { path: [], totalCost: 0, distance: 0, message: "Error: Could not find a path between the selected points." };
}