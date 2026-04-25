import { useState, useCallback } from 'react'
import { ComposableMap, Geographies, Geography, ZoomableGroup, Marker } from 'react-simple-maps'
import { getTranslations } from '../data.js'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

const COUNTRY_CENTROIDS = {
  'DK':[56.3,9.5],'DE':[51.2,10.5],'US':[37.1,-95.7],'GB':[55.4,-3.4],
  'FR':[46.2,2.2],'SE':[62.0,15.0],'NO':[65.0,13.0],'FI':[64.0,26.0],
  'NL':[52.3,5.3],'PL':[51.9,19.1],'IT':[41.9,12.6],'ES':[40.5,-3.7],
  'JP':[36.2,138.3],'CN':[35.9,104.2],'AU':[-25.3,133.8],'BR':[-14.2,-51.9],
  'IN':[20.6,78.9],'RU':[61.5,105.3],'CA':[56.1,-106.4],'MX':[23.6,-102.6],
  'AR':[-38.4,-63.6],'ZA':[-30.6,22.9],'EG':[26.8,30.8],'NG':[9.1,8.7],
  'KR':[35.9,127.8],'SG':[1.3,103.8],'AE':[23.4,53.8],'TR':[38.9,35.2],
  'SA':[23.9,45.1],'ID':[-0.8,113.9],'TH':[15.9,100.9],'PH':[12.9,121.8],
  'UA':[48.4,31.2],'PT':[39.4,-8.2],'BE':[50.5,4.5],'CH':[46.8,8.2],
  'AT':[47.5,14.6],'CZ':[49.8,15.5],'HU':[47.2,19.5],'RO':[45.9,24.9],
  'GR':[39.1,21.8],'IL':[31.5,34.8],'PK':[30.4,69.3],'BD':[23.7,90.4],
  'VN':[14.1,108.3],'MY':[4.2,101.9],'NZ':[-40.9,172.7],'IR':[32.4,53.7],
  'IQ':[33.2,43.7],'KE':[-0.0,37.9],'MA':[31.8,-7.1],'TN':[34.0,9.0],
  'SK':[48.7,19.7],'HR':[45.1,15.2],'RS':[44.0,21.0],'BG':[42.7,25.5],
}

export default function MiniWorldMap({ countries, lang }) {
  const t = getTranslations(lang)
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState([10, 52])

  if (!Array.isArray(countries) || countries.length === 0) return null

  const maxCount = Math.max(1, ...countries.map(c => c.count))

  const handleMoveEnd = useCallback(({ coordinates, zoom: z }) => {
    setCenter(coordinates)
    setZoom(z)
  }, [])

  const zBtn = {
    width: 28, height: 28, borderRadius: 6, border: '1px solid #ddd',
    background: '#fff', cursor: 'pointer', fontSize: 17, fontWeight: 700,
    color: '#2D6A4F', display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12)', lineHeight: 1, padding: 0,
  }

  return (
    <div style={{ position: 'relative', userSelect: 'none', borderRadius: 10, overflow: 'hidden', border: '1px solid #E8E4DF', background: '#C8DFF4' }}>
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button onClick={() => setZoom(z => Math.min(10, z * 1.6))} style={zBtn} title={t.zoomIn}>+</button>
        <button onClick={() => { setZoom(1); setCenter([10, 52]) }} style={{ ...zBtn, fontSize: 13 }} title={t.reset}>↺</button>
        <button onClick={() => setZoom(z => Math.max(1, z / 1.6))} style={zBtn} title={t.zoomOut}>−</button>
      </div>
      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale: 145, center: [0, 10] }}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <ZoomableGroup zoom={zoom} center={center} onMoveEnd={handleMoveEnd}>
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies && geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="#D4E6B5"
                  stroke="#B5C99A"
                  strokeWidth={0.4}
                  style={{
                    default: { outline: 'none' },
                    hover: { fill: '#c0dba0', outline: 'none' },
                    pressed: { outline: 'none' },
                  }}
                />
              ))
            }
          </Geographies>
          {countries.map(d => {
            const coords = COUNTRY_CENTROIDS[d.country_code]
            if (!coords) return null
            const r = Math.max(4, Math.min(18, 4 + (d.count / maxCount) * 14)) / zoom
            const fs = Math.max(5, 8 / zoom)
            return (
              <Marker key={d.country_code} coordinates={[coords[1], coords[0]]}>
                <circle r={r} fill="rgba(45,106,79,0.75)" stroke="#fff" strokeWidth={1.2 / zoom} />
                {d.count > 1 && (
                  <text textAnchor="middle" dy={fs * 0.35} fill="#fff" fontSize={fs} fontWeight="700" style={{ pointerEvents: 'none' }}>
                    {d.count}
                  </text>
                )}
              </Marker>
            )
          })}
        </ZoomableGroup>
      </ComposableMap>
      {zoom > 1 && (
        <div style={{ textAlign: 'center', fontSize: 11, color: '#666', padding: '4px 0 6px', background: 'rgba(255,255,255,0.7)' }}>
          {t.scrollToZoomDragToPan}
        </div>
      )}
    </div>
  )
}
