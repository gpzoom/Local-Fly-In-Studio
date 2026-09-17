import { WebMapTileServiceImageryProvider } from 'cesium';

/**
 * USGS The National Map's imagery service (aerial/satellite), consumed as a
 * WMTS endpoint. Verify the exact currently-published USGS WMTS URL and
 * layer/tile-matrix-set identifiers against USGS's own documentation before
 * relying on this — the values below are believed correct as of this
 * writing but USGS endpoints have moved before. No Cesium ion is used here
 * or anywhere else in this file.
 */
export function createUsgsImageryProvider(): WebMapTileServiceImageryProvider {
  return new WebMapTileServiceImageryProvider({
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/WMTS/tile/1.0.0/USGSImageryOnly/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    layer: 'USGSImageryOnly',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: 'default028mm',
    maximumLevel: 19,
  });
}
