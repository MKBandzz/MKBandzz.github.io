1) Prepare data in QGIS
   - Export roads layer to GeoJSON as 'roads.geojson'. Ensure properties include:
     Speed (int km/h), Path ('BE'|'EB'|'B'), Type (string), Name (string), Level (int)
   - Export POIs to 'pois.geojson' (fields: name, number, type)

2) Run preprocessing (requires shapely)
   - python3 -m pip install shapely
   - python3 build_graph.py
   - This produces: graph.json and roads_clean.geojson

3) Test locally
   - Put index.html, graph.json, roads_clean.geojson, pois.geojson in same folder
   - python3 -m http.server 8000
   - Open http://localhost:8000 in your browser

4) Deploy to GitHub Pages
   - Create a new repo, push all files to main branch
   - In Repo Settings → Pages → set Branch = main, Folder = / (root)
   - Your site will be live at https://<username>.github.io/<repo>/

5) Tweaks
   - If your coordinates are not WGS84: either reproject in QGIS to EPSG:4326 OR adapt the front-end coordinate transform.
   - To make routing quicker or support very large graphs, consider precomputing edge geometries inside graph.json and indexing nodes with spatial indexing (rtree) for snapping.

