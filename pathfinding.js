// ====================================================================
// PATHFINDING - Road Network Graph with Direction & Level Rules
// ====================================================================
// Graph respects: Path (B/BE/EB), Level connectivity (|Δlevel| ≤ 1)
// Cost = distance/speed (time-based routing)
// ====================================================================

let roadGraph = {};
let roadSegments = []; // for segment-based nearest selection

/**
 * Parse level from feature properties. Handles "0", "1", "-1", "NA", null.
 * @returns {number} Numeric level (default 0)
 */
function parseLevel(props) {
    const val = props?.Level ?? props?.level;
    if (val === null || val === undefined || val === 'NA') return 0;
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
}

/**
 * Parse Path attribute: B=both, BE=forward, EB=backward.
 * @returns {{forward: boolean, backward: boolean}}
 */
function parsePath(props) {
    const path = (props?.Path ?? props?.oneway ?? 'B').toString().toUpperCase();
    return {
        forward: path === 'B' || path === 'BE',
        backward: path === 'B' || path === 'EB'
    };
}

/**
 * Euclidean distance between [x,z] coordinates.
 */
function calculateDistance(coord1, coord2) {
    const dx = coord1[0] - coord2[0];
    const dz = coord1[1] - coord2[1];
    return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Check if two levels can connect: |level1 - level2| ≤ 1
 */
function levelsCanConnect(level1, level2) {
    return Math.abs(level1 - level2) <= 1;
}

/**
 * Add directed edge to graph.
 * Ensures BOTH endpoints exist as nodes so we can safely expand from any nodeId we encounter.
 */
function addEdge(graph, fromId, toId, level, cost, fromCoord, toCoord) {
    if (!graph[fromId]) {
        graph[fromId] = { x: fromCoord[0], z: fromCoord[1], edges: [] };
    }
    if (!graph[toId]) {
        graph[toId] = { x: toCoord[0], z: toCoord[1], edges: [] };
    }
    graph[fromId].edges.push({ toId, level, cost });
}

/**
 * Build road graph from GeoJSON features.
 * Uses RAW [X, Z] block coordinates (before display inversion).
 * Accepts either raw GeoJSON features ({ geometry, properties }) or OpenLayers Feature instances.
 * @param {Array} features - GeoJSON features or ol.Feature[] with geometry.coordinates
 */
function buildRoadGraph(features) {
    roadGraph = {};
    roadSegments = [];

    if (!features || !Array.isArray(features)) return;

    features.forEach(feature => {
        if (!feature || (typeof feature !== 'object')) return;
        // Support both raw GeoJSON (feature.geometry) and OpenLayers (feature.getGeometry())
        const geom = typeof feature.getGeometry === 'function' ? feature.getGeometry() : feature.geometry;
        if (!geom) return;

        const type = typeof geom.getType === 'function' ? geom.getType() : geom.type;
        if (type !== 'LineString') return;

        const coords = typeof geom.getCoordinates === 'function' ? geom.getCoordinates() : geom.coordinates;
        if (!coords || coords.length < 2) return;

        // Properties: raw GeoJSON has feature.properties; OpenLayers has feature.get(name)
        let props = {};
        if (feature.properties && typeof feature.properties === 'object') {
            props = feature.properties;
        } else if (typeof feature.get === 'function') {
            ['Path', 'path', 'oneway', 'Level', 'level', 'Speed', 'speed', 'Length', 'length', 'Type', 'type'].forEach(k => {
                const v = feature.get(k);
                if (v !== undefined) props[k] = v;
            });
        }
        // Exclude Walkway / Walkways from pathfinding
        const roadType = (props?.Type ?? props?.type ?? '').toString().toLowerCase();
        if (roadType === 'walkway' || roadType === 'walkways') return;

        const path = parsePath(props);
        const level = parseLevel(props);
        const speed = Math.max(1, parseFloat(props?.speed ?? props?.Speed ?? 50));

        for (let i = 0; i < coords.length - 1; i++) {
            const start = coords[i];
            const end = coords[i + 1];
            const dist = calculateDistance(start, end);
            const cost = dist / speed; // time-based cost

            const startId = `${Math.round(start[0])},${Math.round(start[1])}`;
            const endId = `${Math.round(end[0])},${Math.round(end[1])}`;

            // Store segment for later nearest-segment queries
            roadSegments.push({
                start,
                end,
                startId,
                endId,
                roadType
            });

            if (path.forward) {
                addEdge(roadGraph, startId, endId, level, cost, start, end);
            }
            if (path.backward) {
                addEdge(roadGraph, endId, startId, level, cost, end, start);
            }
        }
    });

    console.log(`Road graph built: ${Object.keys(roadGraph).length} nodes`);
}

/**
 * Distance from point P to segment AB.
 */
function pointToSegmentDistance(p, a, b) {
    const vx = b[0] - a[0];
    const vz = b[1] - a[1];
    const wx = p[0] - a[0];
    const wz = p[1] - a[1];

    const c1 = vx * wx + vz * wz;
    if (c1 <= 0) return calculateDistance(p, a);

    const c2 = vx * vx + vz * vz;
    if (c2 <= c1) return calculateDistance(p, b);

    const t = c1 / c2;
    const proj = [a[0] + t * vx, a[1] + t * vz];
    return calculateDistance(p, proj);
}

/**
 * Find nearest road node to a click coordinate within max blocks.
 * Preference order within radius:
 *   1. Non-ramp, non-highway segments
 *   2. Non-ramp segments (including highways)
 *   3. Any segment (including ramps) – only if nothing else nearby
 * Within the chosen class, uses nearest segment (even between vertices) and
 * snaps to the closer endpoint of that segment. Falls back to pure node search if needed.
 *
 * @param {Array<number>} targetCoord - [x, z] in block coords
 * @returns {string|null} Node ID "x,z" or null
 */
function findNearestNode(targetCoord) {
    const MAX_DISTANCE = 30;

    // Helper: best segment within radius that matches filter
    function bestSegment(filterFn) {
        let best = null;
        let bestDist = Infinity;
        for (const seg of roadSegments) {
            if (filterFn && !filterFn(seg)) continue;
            const d = pointToSegmentDistance(targetCoord, seg.start, seg.end);
            if (d < bestDist && d <= MAX_DISTANCE) {
                bestDist = d;
                best = seg;
            }
        }
        return best;
    }

    const isRamp = (t) => t === 'ramp';
    const isHighway = (t) => t === 'highway';

    // 1) Non-ramp, non-highway segments
    let bestSeg = bestSegment(seg => !isRamp(seg.roadType) && !isHighway(seg.roadType));
    // 2) If none, allow highways but still avoid ramps
    if (!bestSeg) bestSeg = bestSegment(seg => !isRamp(seg.roadType));
    // 3) If still none, allow any segment (including ramps)
    if (!bestSeg) bestSeg = bestSegment(null);

    if (bestSeg) {
        const dStart = calculateDistance(targetCoord, bestSeg.start);
        const dEnd = calculateDistance(targetCoord, bestSeg.end);
        return dStart <= dEnd ? bestSeg.startId : bestSeg.endId;
    }

    // 2. Fallback: nearest node within radius
    let nearestId = null;
    let minDist = Infinity;

    for (const nodeId in roadGraph) {
        const node = roadGraph[nodeId];
        const dist = calculateDistance([node.x, node.z], targetCoord);
        if (dist < minDist && dist <= MAX_DISTANCE) {
            minDist = dist;
            nearestId = nodeId;
        }
    }
    return nearestId;
}

/**
 * A* pathfinding with level connectivity.
 * State: (nodeId, level) - can only traverse to edge if |edgeLevel - currentLevel| ≤ 1
 */
function calculatePath(startNodeId, endNodeId) {
    if (!roadGraph[startNodeId] || !roadGraph[endNodeId]) {
        return { path: [], totalCost: 0, distance: 0, message: 'Start or end node not found.' };
    }

    const endNode = roadGraph[endNodeId];
    const endCoord = [endNode.x, endNode.z];

    function heuristic(nodeId) {
        const n = roadGraph[nodeId];
        return n ? calculateDistance([n.x, n.z], endCoord) / 80 : 0; // rough time estimate
    }

    // Frontier: { nodeId, level, gScore, fScore }
    const openSet = [];
    const gScore = {};  // key: "nodeId,level" -> cost
    const cameFrom = {}; // key: "nodeId,level" -> { nodeId, level }
    const visited = new Set();

    // Start: can enter at any level of edges FROM start (outgoing)
    const startEdges = roadGraph[startNodeId].edges;
    const startLevels = [...new Set(startEdges.map(e => e.level))];
    if (startLevels.length === 0) {
        return { path: [], totalCost: 0, distance: 0, message: 'Start node has no outgoing edges.' };
    }

    for (const level of startLevels) {
        const key = `${startNodeId},${level}`;
        gScore[key] = 0;
        openSet.push({ nodeId: startNodeId, level, gScore: 0, fScore: heuristic(startNodeId) });
    }

    while (openSet.length > 0) {
        openSet.sort((a, b) => a.fScore - b.fScore);
        const current = openSet.shift();
        const { nodeId, level, gScore: g } = current;
        const key = `${nodeId},${level}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (nodeId === endNodeId) {
            // Reconstruct path
            const path = [];
            let cur = { nodeId, level };
            while (cur) {
                const node = roadGraph[cur.nodeId];
                path.push([node.x, node.z]);
                cur = cameFrom[`${cur.nodeId},${cur.level}`];
            }
            path.reverse();

            let totalDist = 0;
            for (let i = 0; i < path.length - 1; i++) {
                totalDist += calculateDistance(path[i], path[i + 1]);
            }

            return {
                path,
                totalCost: g,
                distance: totalDist,
                message: 'Route found.'
            };
        }

        const node = roadGraph[nodeId];
        for (const edge of node.edges) {
            if (!levelsCanConnect(level, edge.level)) continue;

            const tentativeG = g + edge.cost;
            const edgeKey = `${edge.toId},${edge.level}`;

            if (visited.has(edgeKey)) continue;
            const prevG = gScore[edgeKey];
            if (prevG !== undefined && tentativeG >= prevG) continue;

            cameFrom[edgeKey] = { nodeId, level };
            gScore[edgeKey] = tentativeG;
            const f = tentativeG + heuristic(edge.toId);
            openSet.push({ nodeId: edge.toId, level: edge.level, gScore: tentativeG, fScore: f });
        }
    }

    return { path: [], totalCost: 0, distance: 0, message: 'No path found.' };
}
