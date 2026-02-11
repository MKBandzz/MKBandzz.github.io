class RegionMap {

    constructor(regionMap, tileSize, worldMinX, worldMinZ, worldWidth, worldHeight) {
        this.regionMap = regionMap;
        this.tileSize = tileSize;
        this.worldMinX = worldMinX;
        this.worldMinZ = worldMinZ;
        this.worldWidth = worldWidth;
        this.worldHeight = worldHeight;
    }

    hasTile(tileX, tileZ, unminedZoomLevel) {
        const zoomFactor = Math.pow(2, unminedZoomLevel);

        const minTileX = Math.floor(this.worldMinX * zoomFactor / this.tileSize);
        const minTileZ = Math.floor(this.worldMinZ * zoomFactor / this.tileSize);
        const maxTileX = Math.ceil((this.worldMinX + this.worldWidth) * zoomFactor / this.tileSize) - 1;
        const maxTileZ = Math.ceil((this.worldMinZ + this.worldHeight) * zoomFactor / this.tileSize) - 1;

        if (tileX < minTileX || tileZ < minTileZ || tileX > maxTileX || tileZ > maxTileZ) {
            return false;
        }

        const tileBlockSize = this.tileSize / zoomFactor;
        const tileBlockPoint = {
            x: tileX * tileBlockSize,
            z: tileZ * tileBlockSize
        };


        const tileRegionPoint = {
            x: Math.floor(tileBlockPoint.x / 512),
            z: Math.floor(tileBlockPoint.z / 512)
        };
        const tileRegionSize = Math.ceil(tileBlockSize / 512);

        for (let x = tileRegionPoint.x; x < tileRegionPoint.x + tileRegionSize; x++) {
            for (let z = tileRegionPoint.z; z < tileRegionPoint.z + tileRegionSize; z++) {
                const group = {
                    x: Math.floor(x / 32),
                    z: Math.floor(z / 32)
                };
                const regionMap = this.regionMap.find(e => e.x == group.x && e.z == group.z);
                if (regionMap) {
                    const relX = x - group.x * 32;
                    const relZ = z - group.z * 32;
                    const inx = relZ * 32 + relX;
                    var b = regionMap.m[Math.floor(inx / 32)];
                    var bit = inx % 32;
                    var found = (b & (1 << bit)) != 0;
                    if (found) return true;
                }
            }
        }
        return false;
    };
}

class RedDotMarker {

    #source = undefined;
    #layer = undefined;
    #map = undefined;
    #dataProjection = undefined;
    #viewProjection = undefined;

    constructor(map, dataProjection, viewProjection) {
        this.#map = map;
        this.#dataProjection = dataProjection;
        this.#viewProjection = viewProjection;

        this.#source = new ol.source.Vector({
            features: []
        });
        this.#layer = new ol.layer.Vector({
            source: this.#source,
            zIndex: 1000
        });

        this.#map.addLayer(this.#layer);

        window.addEventListener('hashchange', (e) => { this.#hashChanged(e.newURL) });
        this.#hashChanged(window.location.href);
    }

    getCoordinates() {
        return RedDotMarker.getCoordinatesFromUrlHash(window.location.hash);
    }

    static getCoordinatesFromUrlHash(hash) {
        if (!hash || hash.length <= 1) return undefined;

        const q = new URLSearchParams(hash.substring(1))
        const rx = q.get('rx');
        const rz = q.get('rz');
        if (!rx || !rz) return undefined;
       
        const c = [parseInt(rx), parseInt(rz)];
        return c;
    }

    static getUrlHashWithCoordinates(hash, coordinates) {
        hash ??= '#';
        const q = new URLSearchParams(hash.substring(1));
        if (!coordinates) {
            q.delete('rx');
            q.delete('rz');
        } else {
            q.set('rx', coordinates[0]);
            q.set('rz', coordinates[1]);
        }
        const s = q.toString();
        return '#' + s;
    }

    setCoordinates(coordinates) {        
        const url = new URL(window.location.href);
        url.hash = RedDotMarker.getUrlHashWithCoordinates(url.hash, coordinates);
        window.location.replace(url);
    }

    #hashChanged(newURL) {
        const c = RedDotMarker.getCoordinatesFromUrlHash(new URL(newURL).hash);
        this.#setRedDotMarker(c);
    }

    #setRedDotMarker(coordinates) {
        this.#source.clear();

        if (!coordinates) return;

        const marker = new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.transform(coordinates, this.#dataProjection, this.#viewProjection))
        });

        marker.setStyle(new ol.style.Style({
            image: new ol.style.Circle({
                radius: 6,
                fill: new ol.style.Fill({
                    color: 'red'
                }),
                stroke: new ol.style.Stroke({
                    color: '#ffffff',
                    width: 2
                })
            }),
            text: new ol.style.Text({
                text: coordinates[0] + ', ' + coordinates[1],
                font: "bold 14px Arial",
                offsetY: 25,
                fill: new ol.style.Fill({ color: '#000000' }),
                stroke: new ol.style.Stroke({
                    color: '#ffffff',
                    width: 3
                }),
                padding: [4, 6, 4, 6],
                //backgroundFill: new ol.style.Fill({ color: '#ffff00' })
            })
        }));

        this.#source.addFeature(marker);
    }

}

class Unmined {

    olMap = null;

    gridLayer = null;
    coordinateLayer = null;
    viewProjection = null;
    dataProjection = null;
    regionMap = null;
    markersLayer = null;
    playerMarkersLayer = null;
    pathLayer = null;
    pathLayerSource = null;

    #scaleLine = null;
    #options = null;

    static defaultOptions = {
        enableGrid: true,
        showGrid: true,
        binaryGrid: true,
        showScaleBar: true,
        denseGrid: false,
        showMarkers: true,
        showPlayers: true,
        centerX: 0,
        centerZ: 0
    }

    constructor(mapElement, options, regions) {

        const worldTileSize = 256;

        this.#options = { ...Unmined.defaultOptions, ...options };

        this.loadSettings();

        const worldMinX = this.#options.minRegionX * 512;
        const worldMinZ = this.#options.minRegionZ * 512;
        const worldWidth = (this.#options.maxRegionX + 1 - this.#options.minRegionX) * 512;
        const worldHeight = (this.#options.maxRegionZ + 1 - this.#options.minRegionZ) * 512;

        this.regionMap = new RegionMap(regions, worldTileSize, worldMinX, worldMinZ, worldWidth, worldHeight);

        const dpiScale = window.devicePixelRatio ?? 1.0;

        this.#initProjections(
            Math.max(
                Math.abs(worldMinX),
                Math.abs(worldMinZ),
                Math.abs(worldMinX + worldWidth),
                Math.abs(worldMinX + worldHeight)
            )
        );
        const mapExtent = ol.proj.transformExtent(
            ol.extent.boundingExtent([
                [worldMinX, worldMinZ],
                [worldMinX + worldWidth, worldMinZ + worldHeight]]),
            this.dataProjection,
            this.viewProjection);

        const mapZoomLevels = this.#options.maxZoom - this.#options.minZoom;
        const resolutions = new Array(mapZoomLevels + 1);
        for (let z = 0; z <= mapZoomLevels; ++z) {

            let b = 1 * Math.pow(2, mapZoomLevels - z - this.#options.maxZoom);
            b = ol.proj.transform([b, b], this.dataProjection, this.viewProjection)[0];
            resolutions[z] = b * dpiScale;
        }


        var tileGrid = new ol.tilegrid.TileGrid({
            extent: mapExtent,
            origin: [0, 0],
            resolutions: resolutions,
            tileSize: worldTileSize / dpiScale
        });

        var unminedLayer =
            new ol.layer.Tile({
                source: new ol.source.XYZ({
                    projection: this.viewProjection,
                    tileGrid: tileGrid,
                    tilePixelRatio: dpiScale,
                    tileSize: worldTileSize / dpiScale,

                    tileUrlFunction: (coordinate) => {
                        const tileX = coordinate[1];
                        const tileY = coordinate[2];

                        const worldZoom = -(mapZoomLevels - coordinate[0]) + this.#options.maxZoom;

                        if (this.regionMap.hasTile(tileX, tileY, worldZoom)) {
                            const url = ('tiles/zoom.{z}/{xd}/{yd}/tile.{x}.{y}.' + this.#options.imageFormat)
                                .replace('{z}', worldZoom)
                                .replace('{yd}', Math.floor(tileY / 10))
                                .replace('{xd}', Math.floor(tileX / 10))
                                .replace('{y}', tileY)
                                .replace('{x}', tileX);
                            return url;
                        }
                        else
                            return undefined;
                    }
                })
            });

        var mousePositionControl = new ol.control.MousePosition({
            coordinateFormat: ol.coordinate.createStringXY(0),
            projection: this.dataProjection
        });

        const map = new ol.Map({
            target: mapElement,
            controls: ol.control.defaults.defaults().extend([
                mousePositionControl
            ]),
            layers: [
                unminedLayer,
                /*
                new ol.layer.Tile({
                    source: new ol.source.TileDebug({
                        tileGrid: unminedTileGrid,
                        projection: viewProjection
                    })
                })
                */

            ],
            view: new ol.View({
                center: ol.proj.transform([this.#options.centerX, this.#options.centerZ], this.dataProjection, this.viewProjection),
                extent: mapExtent,
                projection: this.viewProjection,
                resolutions: tileGrid.getResolutions(),
                maxZoom: mapZoomLevels,
                zoom: mapZoomLevels - this.#options.maxZoom,
                constrainResolution: true,
                showFullExtent: true,
                constrainOnlyCenter: true,
                enableRotation: false
            })
        });

        if (this.#options.markers && this.#options.markers.length > 0) {
            this.markersLayer = this.createMarkersLayer(this.#options.markers);
            map.addLayer(this.markersLayer);
        }

        if (this.#options.playerMarkers && this.#options.playerMarkers.length > 0) {
            this.playerMarkersLayer = this.createMarkersLayer(this.#options.playerMarkers);
            map.addLayer(this.playerMarkersLayer);
        }

        if (this.#options.background) {
            mapElement.style.backgroundColor = this.#options.background;
        }

        this.olMap = map;

        this.updateGraticule();
        this.updateScaleBar();
        this.updateMarkersLayer();
        this.updatePlayerMarkersLayer();
        this.olMap.addControl(this.createContextMenu());

        this.redDotMarker = new RedDotMarker(this.olMap, this.dataProjection, this.viewProjection);

        this.centerOnRedDotMarker();

        // Pathfinding state
        this.pathStartCoordinates = undefined;
        this.pathEndCoordinates = undefined;
        this.initPathLayer();
    }

    center(blockCoordinates) {
        const view = this.olMap.getView();
        const v = ol.proj.transform(blockCoordinates, this.dataProjection, this.viewProjection);
        view.setCenter(v);
    }

    centerOnRedDotMarker() {                
        const c = this.redDotMarker.getCoordinates();
        if (!c) return;
        
        this.center(c);
    }

    placeRedDotMarker(coordinates) {
        this.redDotMarker.setCoordinates(coordinates);
    }

    initPathLayer() {
        this.pathLayerSource = new ol.source.Vector({ features: [] });
        this.pathLayer = new ol.layer.Vector({
            source: this.pathLayerSource,
            zIndex: 1500
        });
        this.olMap.addLayer(this.pathLayer);
    }

    clearPathVisualization() {
        if (this.pathLayerSource) {
            this.pathLayerSource.clear();
            this.updatePathMarkers();
        }
        this.hidePathInfoPanel();
    }

    // Transform block [x,z] to view coords; negate Z so path line aligns with roads layer (which uses inverted Z for display)
    pathBlockToView(coord) {
        return ol.proj.transform([coord[0], -coord[1]], this.dataProjection, this.viewProjection);
    }

    // Transform block [x,z] to view for A/B markers only; no negation so markers match the coordinate display where you clicked
    pathBlockToViewMarker(coord) {
        return ol.proj.transform([coord[0], coord[1]], this.dataProjection, this.viewProjection);
    }

    drawPath(blockCoords) {
        if (!this.pathLayerSource) return;

        this.clearPathVisualization();
        const toView = (c) => this.pathBlockToView(c);

        if (blockCoords && blockCoords.length >= 2) {
            const lineFeature = new ol.Feature({
                geometry: new ol.geom.LineString(blockCoords.map(toView))
            });
            lineFeature.setStyle(new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: '#00c2ff',
                    width: 5,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }));
            this.pathLayerSource.addFeature(lineFeature);
        }

        this.updatePathMarkers();
    }

    updatePathMarkers() {
        if (!this.pathLayerSource) return;
        const toViewMarker = (c) => this.pathBlockToViewMarker(c);

        if (this.pathStartCoordinates) {
            const startFeature = new ol.Feature({
                geometry: new ol.geom.Point(toViewMarker(this.pathStartCoordinates))
            });
            startFeature.setStyle(new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 8,
                    fill: new ol.style.Fill({ color: '#3cb371' }),
                    stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
                }),
                text: new ol.style.Text({
                    text: 'A',
                    font: 'bold 12px sans-serif',
                    offsetY: -14,
                    fill: new ol.style.Fill({ color: '#2e7d32' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
                })
            }));
            this.pathLayerSource.addFeature(startFeature);
        }
        if (this.pathEndCoordinates) {
            const endFeature = new ol.Feature({
                geometry: new ol.geom.Point(toViewMarker(this.pathEndCoordinates))
            });
            endFeature.setStyle(new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 8,
                    fill: new ol.style.Fill({ color: '#ff5a5f' }),
                    stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
                }),
                text: new ol.style.Text({
                    text: 'B',
                    font: 'bold 12px sans-serif',
                    offsetY: -14,
                    fill: new ol.style.Fill({ color: '#c62828' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
                })
            }));
            this.pathLayerSource.addFeature(endFeature);
        }
    }

    calculateAndRenderPath() {
        if (!this.pathStartCoordinates || !this.pathEndCoordinates) return;

        if (typeof findNearestNode !== 'function' || typeof calculatePath !== 'function') {
            Unmined.toast('Pathfinding not available');
            return;
        }

        if (!roadGraph || Object.keys(roadGraph).length === 0) {
            Unmined.toast('Road network is still loading');
            return;
        }

        // Road graph uses raw block coords [x, z]; map click gives Unmined data coords where Z is inverted.
        // Convert to graph block coords by negating Z so node lookup matches the displayed markers.
        const blockCoordForGraph = (c) => [c[0], -c[1]];
        const startId = findNearestNode(blockCoordForGraph(this.pathStartCoordinates));
        const endId = findNearestNode(blockCoordForGraph(this.pathEndCoordinates));

        if (!startId || !endId) {
            Unmined.toast('No nearby road node for one of the points');
            this.clearPathVisualization();
            return;
        }

        const result = calculatePath(startId, endId);

        if (!result.path || result.path.length === 0) {
            Unmined.toast(result.message || 'No route found');
            this.clearPathVisualization();
            return;
        }

        this.drawPath(result.path);

        const distanceText = result.distance != null ? `${result.distance.toFixed(0)} blocks` : '';
        this.showPathInfoPanel(distanceText, result.message || 'Route found');
    }

    showPathInfoPanel(distanceText, message) {
        const panel = document.getElementById('path-info-panel');
        if (!panel) return;
        const content = panel.querySelector('.path-info-content');
        const msgEl = panel.querySelector('.path-info-message');
        if (content) content.textContent = distanceText || '';
        if (msgEl) msgEl.textContent = message || '';
        panel.style.display = 'block';
    }

    hidePathInfoPanel() {
        const panel = document.getElementById('path-info-panel');
        if (panel) panel.style.display = 'none';
    }

    createMarkersLayer(markers) {
        var features = [];

        for (var i = 0; i < markers.length; i++) {
            var item = markers[i];
            var longitude = item.x;
            var latitude = item.z;

            var feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.transform([longitude, latitude], this.dataProjection, this.viewProjection))
            });

            var style = new ol.style.Style();
            if (item.image)
                style.setImage(new ol.style.Icon({
                    src: item.image,
                    anchor: item.imageAnchor,
                    scale: item.imageScale
                }));

            if (item.text) {
                style.setText(new ol.style.Text({
                    text: item.text,
                    font: item.font,
                    offsetX: item.offsetX,
                    offsetY: item.offsetY,
                    fill: item.textColor ? new ol.style.Fill({
                        color: item.textColor
                    }) : null,
                    padding: item.textPadding ?? [2, 4, 2, 4],
                    stroke: item.textStrokeColor ? new ol.style.Stroke({
                        color: item.textStrokeColor,
                        width: item.textStrokeWidth
                    }) : null,
                    backgroundFill: item.textBackgroundColor ? new ol.style.Fill({
                        color: item.textBackgroundColor
                    }) : null,
                    backgroundStroke: item.textBackgroundStrokeColor ? new ol.style.Stroke({
                        color: item.textBackgroundStrokeColor,
                        width: item.textBackgroundStrokeWidth
                    }) : null,
                }));
            }

            feature.setStyle(style);

            features.push(feature);
        }

        var vectorSource = new ol.source.Vector({
            features: features
        });

        var vectorLayer = new ol.layer.Vector({
            source: vectorSource
        });
        return vectorLayer;
    }

    static defaultPlayerMarkerStyle = {
        image: "playerimages/default.png",
        imageAnchor: [0.5, 0.5],
        imageScale: 0.25,

        textColor: "white",
        offsetX: 0,
        offsetY: 20,
        font: "14px Arial",
        //textStrokeColor: "black",
        //textStrokeWidth: 2,
        textBackgroundColor: "#00000088",
        //textBackgroundStrokeColor: "black",
        //textBackgroundStrokeWidth: 1,
        textPadding: [2, 4, 2, 4],
    }

    static playerToMarker(player) {
        var marker = Object.assign({}, Unmined.defaultPlayerMarkerStyle);
        marker.x = player.x;
        marker.z = player.z;
        marker.text = player.name;
        return marker;
    }

    static createPlayerMarkers(players) {
        let markers = players.map(player => Unmined.playerToMarker(player));
        return markers;
    }

    updateGraticule() {
        if (!this.olMap) return;

        if (this.gridLayer) this.olMap.removeLayer(this.gridLayer);
        if (this.coordinateLayer) this.olMap.removeLayer(this.coordinateLayer);

        this.gridLayer = null;
        if (!this.#options.enableGrid) return;

        this.gridLayer = this.#createGraticuleLayer(false);
        this.coordinateLayer = this.#createGraticuleLayer(true);

        this.gridLayer?.setVisible(this.#options.showGrid);
        this.coordinateLayer?.setVisible(this.#options.showGrid);

        this.gridLayer.setZIndex(500);
        this.coordinateLayer.setZIndex(10000);

        this.olMap.addLayer(this.gridLayer);
        this.olMap.addLayer(this.coordinateLayer);
    }

    #createGraticuleLayer(coord) {
        const bgColor = "#ffffff";
        const fgColor = "#222222";

        const intervalCount = this.olMap.getView().getMaxZoom() + 2;
        const graticuleIntervals = new Array(intervalCount);

        if (this.#options.binaryGrid) {
            let base = 16;
            for (let z = 0; z < intervalCount; ++z) {
                const intervalInBlocks = base;
                const intervalInDegrees = ol.proj.transform([intervalInBlocks, intervalInBlocks], this.dataProjection, this.viewProjection)[0];
                graticuleIntervals[intervalCount - 1 - z] = intervalInDegrees;
                base *= 2;
            }
        } else {
            const factors = [1, 2, 5];
            let base = 10;
            let factorIndex = 0;
            for (let z = 0; z < intervalCount; ++z) {
                const intervalInBlocks = base * factors[factorIndex++ % factors.length]
                const intervalInDegrees = ol.proj.transform([intervalInBlocks, intervalInBlocks], this.dataProjection, this.viewProjection)[0];
                graticuleIntervals[intervalCount - 1 - z] = intervalInDegrees;
                if (factorIndex % factors.length == 0) base *= 10;
            }
        }

        const graticuleLabelStyle = new ol.style.Text({
            //font: '14px "Finlandica"',
            font: '14px sans-serif',
            placement: "point",
            //fill: new ol.style.Fill({ color: fgColor }),
            //stroke: new ol.style.Stroke({ color: bgColor, width: 20 }),

            fill: new ol.style.Fill({ color: "#fff" }),
            stroke: new ol.style.Stroke({ color: "#000", width: 2 }),

            //padding: [10, 10],
            //backgroundFill: new ol.style.Fill({ color: bgColor }),
            //backgroundStroke: new ol.style.Stroke({ color: fgColor, width: 20 }),
        });

        const graticuleLonLabelStyle = graticuleLabelStyle.clone()
        graticuleLonLabelStyle.setOffsetY(10)

        const graticuleLatLabelStyle = graticuleLabelStyle.clone()
        graticuleLatLabelStyle.setOffsetX(-2)
        graticuleLatLabelStyle.setTextAlign('right')

        const graticuleStrokeStyle = coord
            ? new ol.style.Stroke({
                color: 'rgba(0, 0, 0, 0)',
                width: 0
            })
            : new ol.style.Stroke({
                //color: 'rgba(255,255,255,.6)',
                color: 'rgb(0,0,0)',
                width: .5,
                //lineDash: [2, 4],
            })

        const graticuleLayer = new ol.layer.Graticule({
            strokeStyle: graticuleStrokeStyle,
            showLabels: coord,
            wrapX: false,
            targetSize: this.#options.denseGrid ? 60 : 120,
            intervals: graticuleIntervals,
            lonLabelFormatter: coord ? (lon) => {
                const c = new ol.geom.Point(ol.proj.transform([lon, 0], this.viewProjection, this.dataProjection)).getFirstCoordinate()
                let l = Math.round(c[0])
                if (l == 0) return "x = 0";
                return l.toString()
            } : undefined,
            latLabelFormatter: coord ? (lat) => {
                const c = new ol.geom.Point(ol.proj.transform([0, lat], this.viewProjection, this.dataProjection)).getFirstCoordinate()
                let l = Math.round(c[1])
                if (l == 0) return "z = 0";
                return l.toString()
            } : undefined,
            lonLabelStyle: coord ? graticuleLonLabelStyle : undefined,
            latLabelStyle: coord ? graticuleLatLabelStyle : undefined,
            lonLabelPosition: 1, // 0 = bottom, 1 = top
            latLabelPosition: 1, // 0 = left, 1 = right                        
        })
        return graticuleLayer
    }

    static copyToClipboard(text, toast) {
        if (!navigator || !navigator.clipboard || !navigator.clipboard.writeText) {
            Unmined.toast('Clipboard is not accessible')
            return;
        }

        navigator.clipboard.writeText(text);
        Unmined.toast(toast ?? "Copied!");
    }

    static toast(message) {
        Toastify({
            text: message,
            duration: 2000,
            gravity: "top", // `top` or `bottom`
            position: "center", // `left`, `center` or `right`                        
        }).showToast();
    }


    createContextMenu() {
        const contextmenu = new ContextMenu({
            width: 220,
            defaultItems: false,
            items: [],
        });
        contextmenu.on('open', (evt) => {
            const coordinates = ol.proj.transform(this.olMap.getEventCoordinate(evt.originalEvent), this.viewProjection, this.dataProjection);

            coordinates[0] = Math.round(coordinates[0]);
            coordinates[1] = Math.round(coordinates[1]);

            contextmenu.clear();
            contextmenu.push({
                text: `Copy /tp ${coordinates[0]} ~ ${coordinates[1]}`,
                callback: () => {
                    Unmined.copyToClipboard(`/tp ${coordinates[0]} ~ ${coordinates[1]}`);
                }
            })
            contextmenu.push('-');

            contextmenu.push({
                text: `Place red dot marker here`,
                classname: 'menuitem-reddot',
                callback: () => {
                    this.placeRedDotMarker(coordinates);
                }
            });
            if (this.redDotMarker.getCoordinates()) {
                contextmenu.push({
                    text: `Copy marker link`,
                    callback: () => {
                        Unmined.copyToClipboard(window.location.href);
                    }
                });
                contextmenu.push({
                    text: `Clear marker`,
                    callback: () => {
                        this.placeRedDotMarker(undefined);
                    }
                });
            }
            contextmenu.push('-');

            // Pathfinding menu items (single unified menu)
            const formattedCoords = coordinates[0] + ', ' + coordinates[1];
            const formatPointDisplay = (coords) => coords ? `${coords[0]}, ${coords[1]}` : 'None';

            // Set Path Start
            contextmenu.push({
                text: `Set Path Start (${formatPointDisplay(this.pathStartCoordinates)})`,
                callback: () => {
                    this.pathStartCoordinates = coordinates;
                    this.clearPathVisualization();
                    Unmined.toast(`Path Start (A) set to: ${formattedCoords}`);
                    this.calculateAndRenderPath();
                }
            });

            // Set Path End
            contextmenu.push({
                text: `Set Path End (${formatPointDisplay(this.pathEndCoordinates)})`,
                callback: () => {
                    this.pathEndCoordinates = coordinates;
                    this.clearPathVisualization();
                    Unmined.toast(`Path End (B) set to: ${formattedCoords}`);
                    this.calculateAndRenderPath();
                }
            });

            // Clear Path Points (only if any is set)
            if (this.pathStartCoordinates || this.pathEndCoordinates) {
                contextmenu.push({
                    text: 'Clear Path Points',
                    callback: () => {
                        this.pathStartCoordinates = undefined;
                        this.pathEndCoordinates = undefined;
                        this.clearPathVisualization();
                        Unmined.toast('Path points cleared');
                    }
                });
            }

            contextmenu.push('-');

            if (this.playerMarkersLayer) {
                contextmenu.push(
                    {
                        classname: this.#options.showPlayers ? 'menuitem-checked' : 'menuitem-unchecked',
                        text: 'Show players',
                        callback: () => this.togglePlayers()
                    })
            }

            if (this.markersLayer) {
                contextmenu.push(
                    {
                        classname: this.#options.showMarkers ? 'menuitem-checked' : 'menuitem-unchecked',
                        text: 'Show markers',
                        callback: () => this.toggleMarkers()
                    })
            }


            if (this.markersLayer || this.playerMarkersLayer) {
                contextmenu.push('-');
            }

            if (this.#options.enableGrid) {
                contextmenu.push(
                    {
                        classname: this.#options.showGrid ? 'menuitem-checked' : 'menuitem-unchecked',
                        text: 'Show grid',
                        callback: () => this.toggleGrid()
                    })
                contextmenu.push(
                    {
                        classname: this.#options.denseGrid ? 'menuitem-checked' : 'menuitem-unchecked',
                        text: 'Dense grid',
                        callback: () => this.toggleGridInterval()
                    })
                contextmenu.push(
                    {
                        classname: this.#options.binaryGrid ? 'menuitem-checked' : 'menuitem-unchecked',
                        text: 'Binary coordinates',
                        callback: () => this.toggleBinaryGrid()
                    })
            }

            contextmenu.push(
                {
                    classname: this.#options.showScaleBar ? 'menuitem-checked' : 'menuitem-unchecked',
                    text: 'Show scalebar',
                    callback: () => this.toggleScaleBar()
                })


        })
        return contextmenu;
    }

    toggleGridInterval() {
        this.#options.denseGrid = !this.#options.denseGrid;
        this.updateGraticule();
        this.saveSettings();
    }

    toggleBinaryGrid() {
        this.#options.binaryGrid = !this.#options.binaryGrid;
        this.updateGraticule();
        this.saveSettings();
    }

    toggleGrid() {
        this.#options.showGrid = !this.#options.showGrid;
        this.updateGraticule();
        this.saveSettings();
    }

    toggleScaleBar() {
        this.#options.showScaleBar = !this.#options.showScaleBar;
        this.updateScaleBar();
        this.saveSettings();
    }

    toggleMarkers() {
        this.#options.showMarkers = !this.#options.showMarkers;
        this.updateMarkersLayer();
        this.saveSettings();
    }

    togglePlayers() {
        this.#options.showPlayers = !this.#options.showPlayers;
        this.updatePlayerMarkersLayer();
        this.saveSettings();
    }

    loadSettings() {
        const mapSettings = (() => {
            try {
                const s = localStorage.getItem("mapSettings");
                if (!s) return undefined;
                return JSON.parse(s);
            } catch {
                return undefined;
            }
        })();

        if (!mapSettings) return;
        this.#options.showScaleBar = mapSettings.showScaleBar ?? this.#options.showScaleBar;
        this.#options.showGrid = mapSettings.showGrid ?? this.#options.showGrid;
        this.#options.binaryGrid = mapSettings.binaryGrid ?? this.#options.binaryGrid;
        this.#options.denseGrid = mapSettings.denseGrid ?? this.#options.denseGrid;
        this.#options.showMarkers = mapSettings.showMarkers ?? this.#options.showMarkers;
        this.#options.showPlayers = mapSettings.showPlayers ?? this.#options.showPlayers;

    }

    saveSettings() {
        const mapSettings = {
            showScaleBar: this.#options.showScaleBar,
            showGrid: this.#options.showGrid,
            binaryGrid: this.#options.binaryGrid,
            denseGrid: this.#options.denseGrid,
            showMarkers: this.#options.showMarkers,
            showPlayers: this.#options.showPlayers,
        }
        localStorage.setItem("mapSettings", JSON.stringify(mapSettings))
    }

    updateMarkersLayer() {
        this.markersLayer?.setVisible(this.#options.showMarkers);
    }

    updatePlayerMarkersLayer() {
        this.playerMarkersLayer?.setVisible(this.#options.showPlayers);
    }

    updateScaleBar() {
        if (!this.#options.showScaleBar && this.#scaleLine) {
            this.olMap.removeControl(this.#scaleLine)
            this.#scaleLine = undefined;
        }
        else if (this.#options.showScaleBar && !this.#scaleLine) {
            this.#scaleLine = new ol.control.ScaleLine({
                bar: true,
                minWidth: 200,
            });
            this.olMap.addControl(this.#scaleLine);

        }
    }

    #initProjections(maxCoordValue) {
        const blocksPerDegrees = Math.max(30000000, maxCoordValue) / 270;
        const radius = 270;

        this.viewProjection = new ol.proj.Projection({
            code: 'VIEW',
            units: 'degrees',
            extent: [-radius, -radius, +radius, +radius],
            worldExtent: [-radius, -radius, +radius, +radius],
            global: true,
            //metersPerUnit: 1 * blocksPerDegrees
        });

        this.dataProjection = new ol.proj.Projection({
            code: 'DATA',
            units: 'pixels',
            metersPerUnit: 1
        });

        // Coordinate transformation between view and data
        // OpenLayers Y is positive up, world Y is positive down
        ol.proj.addCoordinateTransforms(this.viewProjection, this.dataProjection,
            function (coordinate) {
                return [coordinate[0] * blocksPerDegrees, -coordinate[1] * blocksPerDegrees];
            },
            function (coordinate) {
                return [coordinate[0] / blocksPerDegrees, -coordinate[1] / blocksPerDegrees];
            });

    }


}