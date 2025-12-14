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
 * Builds the road network graph from GeoJSON features.
 * @param {Array<ol.Feature>} features - OpenLayers features (assumed to be in Data/Block Projection [X, -Z]).
 */
function buildRoadGraph(features) {
    console.log("Building road graph...");
    roadGraph = {}; 
    const nodeCoords = new Map();

    features.forEach(feature => {
        const geometry = feature.getGeometry();
        if (geometry.getType() === 'LineString') {
            const coords = geometry.getCoordinates(); 

            for (let i = 0; i < coords.length - 1; i++) {
                const startCoord = coords[i];
                const endCoord = coords[i+1];

                // Ensure Node IDs are based on rounded integers
                const startNodeId = `${Math.round(startCoord[0])},${Math.round(startCoord[1])}`;
                const endNodeId = `${Math.round(endCoord[0])},${Math.round(endCoord[1])}`;
                
                // Calculate segment distance and cost
                const dist = calculateDistance(startCoord, endCoord);
                const cost = dist; 

                // --- Node Initialization ---
                if (!roadGraph[startNodeId]) {
                    roadGraph[startNodeId] = { 
                        x: Math.round(startCoord[0]), 
                        z: Math.round(startCoord[1]), 
                        neighbors: [] 
                    };
                    nodeCoords.set(startNodeId, [roadGraph[startNodeId].x, roadGraph[startNodeId].z]);
                }
                if (!roadGraph[endNodeId]) {
                    roadGraph[endNodeId] = { 
                        x: Math.round(endCoord[0]), 
                        z: Math.round(endCoord[1]), 
                        neighbors: [] 
                    };
                    nodeCoords.set(endNodeId, [roadGraph[endNodeId].x, roadGraph[endNodeId].z]);
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
 * Finds the nearest road node to a given click coordinate.
 * @param {Array<number>} preciseBlockCoord - The rounded [x, z] block coordinates of the click.
 * @returns {string|null} The ID of the nearest node ("x,z") or null if none found.
 */
function findNearestNode(preciseBlockCoord) {
    
    if (Object.keys(roadGraph).length === 0) {
        console.warn("Road graph is empty. Cannot find nearest node.");
        return null;
    }

    const MAX_DISTANCE_BLOCKS = 10;
    let nearestNodeId = null;
    let minDistance = Infinity;
    const clickCoord = preciseBlockCoord; // [x, z] in integer block coordinates

    // Iterate through all nodes in the *built roadGraph*
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
    } else {
        console.log(`No road node found within ${MAX_DISTANCE_BLOCKS} blocks.`);
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
 * @returns {object} { path: Array<Array<number>>, totalCost: number, distance: number, message: string }
 */
function calculatePath(startNodeId, endNodeId) {
    if (!roadGraph[startNodeId] || !roadGraph[endNodeId]) {
        console.error("Start or End node not found in the road graph.");
        return { path: [], totalCost: 0, distance: 0, message: "Error: Start or End point is not a valid graph node." };
    }
    
    const endCoord = [roadGraph[endNodeId].x, roadGraph[endNodeId].z];

    const openSet = [{ id: startNodeId, fScore: 0 }]; 
    
    const gScore = { [startNodeId]: 0 }; 
    const fScore = { [startNodeId]: calculateDistance([roadGraph[startNodeId].x, roadGraph[startNodeId].z], endCoord) }; 
    const cameFrom = {}; 

    // A* algorithm core logic
    while (openSet.length > 0) {
        openSet.sort((a, b) => a.fScore - b.fScore);
        const current = openSet.shift();
        const currentId = current.id;
        
        if (currentId === endNodeId) {
            // Path found! Reconstruct and return.
            const path = [];
            let tempId = endNodeId;
            while (tempId) {
                const node = roadGraph[tempId];
                path.push([node.x, node.z]);
                tempId = cameFrom[tempId];
            }
            
            const finalPath = path.reverse();
            
            // Calculate and return the total distance for index.html display
            let totalDistance = 0;
            for(let i = 0; i < finalPath.length - 1; i++) {
                totalDistance += calculateDistance(finalPath[i], finalPath[i+1]);
            }

            return { 
                path: finalPath, 
                totalCost: gScore[endNodeId], 
                distance: totalDistance, // <--- CORRECTED RETURN
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