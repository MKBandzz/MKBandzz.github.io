// -------------------------------
// Load Unmined settings
// -------------------------------
const world = UnminedMapProperties;
const regions = UnminedRegions;

// Tiles live in the root folder, not inside /mkbmap
const TILE_BASE = "/tiles";

// -------------------------------
// OpenLayers Map Setup
// -------------------------------
const map = new ol.Map({
  target: 'map',
  layers: [],
  view: new ol.View({
    center: [0, 0],
    zoom: world.defaultZoom || 0,
    minZoom: world.minZoom || 0,
    maxZoom: world.maxZoom || 3,
    constrainOnlyCenter: false
  })
});

// -------------------------------
// Create Tile Layer
// -------------------------------
const tileLayer = new ol.layer.Tile({
  source: new ol.source.XYZ({
    minZoom: world.minZoom,
    maxZoom: world.maxZoom,

    tileSize: 256,

    tileUrlFunction: function (tileCoord) {
      const z = tileCoord[0];
      const x = tileCoord[1];
      const y = -tileCoord[2] - 1;

      const regionX = Math.floor(x / 10);
      const regionZ = Math.floor(y / 10);

      if (!regions[z] ||
          !regions[z][regionX] ||
          regions[z][regionX].indexOf(regionZ) === -1) {
        return ""; // no tile → blank tile
      }

      return (
        TILE_BASE +
        "/zoom." + z +
        "/" + regionX +
        "/" + regionZ +
        "/tile." + x + "." + y + ".png"
      );
    }
  })
});

map.addLayer(tileLayer);

// -------------------------------
// Load Roads Layer
// -------------------------------
fetch("roads.geojson")
  .then(r => r.json())
  .then(json => {
    const features = new ol.format.GeoJSON().readFeatures(json, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:4326'
    });

    const roadsLayer = new ol.layer.Vector({
      source: new ol.source.Vector({ features }),
      style: function (feat) {
        const type = feat.get("Type");
        let color = "white";
        let width = 2;

        if (type === "Highway" || type === "Ramp") {
          color = "yellow"; width = 4;
        } else if (type === "Arterial" || type === "Road") {
          color = "white"; width = 3;
        }

        return new ol.style.Style({
          stroke: new ol.style.Stroke({ color, width })
        });
      }
    });

    map.addLayer(roadsLayer);
  });

// -------------------------------
// Load Property Polygons
// -------------------------------
fetch("properties.geojson")
  .then(r => r.json())
  .then(json => {
    const features = new ol.format.GeoJSON().readFeatures(json, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:4326'
    });

    const poiLayer = new ol.layer.Vector({
      source: new ol.source.Vector({ features }),
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: "cyan",
          width: 2
        }),
        fill: new ol.style.Fill({
          color: "rgba(0,255,255,0.2)"
        })
      })
    });

    map.addLayer(poiLayer);
  });
