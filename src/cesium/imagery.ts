import { WebMapTileServiceImageryProvider } from 'cesium';

/**
 * USGS The National Map's imagery service (aerial/satellite), consumed as a
 * WMTS endpoint. Verify the exact currently-published USGS WMTS URL and
 * layer/tile-matrix-set identifiers against USGS's own documentation before
 * relying on this — the values below are believed correct as of this
 * writing but USGS endpoints have moved before. No Cesium ion is used here
 * or anywhere else in this file.
 *
 * maximumLevel is capped at 16 (~2.4m/pixel), not the tile matrix set's
 * declared ceiling of 23. USGS's actual source imagery is only captured at
 * finer resolution (level 17+, sub-1m/pixel) in select densely-surveyed
 * areas — requesting beyond what a location actually has causes "failed to
 * obtain image tile" errors instead of Cesium's normal, silent upsampling
 * of the coarsest tile it does have. 16 stays within USGS's much more
 * consistent nationwide base coverage.
 */
export function createUsgsImageryProvider(): WebMapTileServiceImageryProvider {
  return new WebMapTileServiceImageryProvider({
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/WMTS/tile/1.0.0/USGSImageryOnly/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    layer: 'USGSImageryOnly',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: 'default028mm',
    maximumLevel: 16,
  });
}
