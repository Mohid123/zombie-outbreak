# 🧟 Zombie Outbreak Simulator

> *"Leon, these residents are evil!"*

A real-world zombie outbreak simulator powered by **Angular 20**, **MapLibre GL JS**, and **WebGL** — spreading undead chaos across actual city maps using real population data, OpenStreetMap infrastructure, and epidemiological modelling. Because if the apocalypse comes, at least it'll look beautiful.

🔗 **Live Demo:** [zombie-outbreak.pages.dev](https://zombie-outbreak.pages.dev)

---

## 🗺️ What Is This?

This project simulates a zombie outbreak on a real interactive map. You pick a location, Patient Zero rises, and the infection spreads — guided by actual population density from WorldPop raster data, city geometry from OpenStreetMap via the Overpass API, and a spatial SIR (Susceptible–Infected–Recovered) epidemiological model under the hood.

No fictional cities. No hand-drawn maps. Your actual neighbourhood, consumed by the undead.

---

## ✨ Features

- 🌍 **Real-world maps** rendered with MapLibre GL JS and styled via MapTiler
- 🧟 **SIR Model simulation** — Susceptible → Infected → Removed, simulated spatially across a hexagonal H3 grid
- 📊 **WorldPop GeoTIFF integration** — real population density data parsed with `geotiff` to seed infection realism
- 🏙️ **Overpass API queries** — pulls live OpenStreetMap data (roads, buildings, amenities) to influence spread patterns
- 🔷 **H3 Hexagonal grid** (`h3-js`) — Uber's H3 spatial index used for efficient neighbour-based infection propagation
- 🎲 **Seeded randomness** (`seedrandom`) — reproducible simulations so you can replay the exact apocalypse that took out your city
- 📸 **Screenshot export** (`html2canvas`) — capture and share your zombie-infested map
- 🗺️ **Geospatial analysis** with Turf.js — spatial operations like buffering, intersections, and point-in-polygon for infection logic
- ⚡ **GPU-accelerated rendering** via WebGL through MapLibre's rendering pipeline
- 💨 **Tailwind CSS v4** — utility-first, PostCSS-powered styling

---

## 🧬 The Science (sort of)

The simulation uses a **spatial SIR model**, the same class of mathematical framework used in real epidemiology:

| State | Description |
|-------|-------------|
| **S** Susceptible | Living humans who haven't been bitten yet. Poor souls. |
| **I** Infected | Active zombies spreading the infection to neighbouring cells. |
| **R** Removed | No longer spreading — either escaped, barricaded, or... gone. |

Each hexagonal H3 cell represents a geographic zone. On every simulation tick:
1. Infected cells attempt to convert susceptible neighbours based on a transmission rate
2. Population density (from WorldPop) weights how many people are available to infect
3. OpenStreetMap road networks influence how fast the outbreak can travel between zones
4. The seeded RNG ensures every run is deterministic and shareable

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Angular 20 (standalone components, signals-ready) |
| Map Rendering | MapLibre GL JS v5 + WebGL |
| Map Tiles | MapTiler |
| Spatial Grid | H3-js (Uber's Hexagonal Hierarchical Geospatial Index) |
| Population Data | WorldPop GeoTIFF rasters, parsed with `geotiff` |
| OSM Data | Overpass API (live queries) |
| Geospatial Ops | Turf.js v3 |
| Styling | Tailwind CSS v4 (PostCSS) |
| Randomness | seedrandom |
| Screenshot | html2canvas |
| Language | TypeScript 5.9 |
| Package Manager | Yarn 1.22 |
| Testing | Karma + Jasmine |
| Deployment | Cloudflare Pages |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+
- **Yarn** v1.22+
- **Angular CLI** v20+
- A **MapTiler API key** (free tier available at [maptiler.com](https://www.maptiler.com/cloud/))

### Installation

```bash
# Clone the repository
git clone https://github.com/Mohid123/zombie-outbreak.git
cd zombie-outbreak

# Install dependencies
yarn install
```

### Configuration

Add your MapTiler API key to the environment configuration:

```typescript
// src/environments/environment.ts
export const environment = {
  production: false,
  mapTilerApiKey: 'YOUR_MAPTILER_API_KEY_HERE'
};
```

### Running the Development Server

```bash
ng serve
```

Navigate to `http://localhost:4200/` — the app reloads automatically on file changes.

### Building for Production

```bash
ng build
```

Build artifacts land in the `dist/` directory, optimised for performance.

### Running Tests

```bash
ng test
```

---

## 📁 Project Structure

```
zombie-outbreak/
├── src/
│   ├── app/
│   │   ├── components/       # Angular UI components
│   │   ├── services/         # Simulation, map, and data services
│   │   └── app.component.*   # Root component
│   ├── environments/         # Environment configs
│   └── styles/               # Global Tailwind styles
├── public/                   # Static assets
├── angular.json              # Angular CLI workspace config
├── tailwind.config.*         # Tailwind CSS v4 setup
├── tsconfig.json             # TypeScript compiler options
└── package.json
```

---

## 🧪 How the Simulation Works

```
1. User selects a location on the map
2. Overpass API fetches real OSM data for the area
3. WorldPop GeoTIFF is sampled for population density
4. The area is tessellated into H3 hexagons
5. Patient Zero is placed in a random hex cell
6. Each simulation tick:
   │
   ├── Infected cells → spread to neighbours (weighted by density + roads)
   ├── Removed cells → no longer infect
   └── Map layers update via WebGL (MapLibre data sources)
7. Repeat until the city falls... or humanity prevails
```

---

## 🌐 Data Sources

- **[WorldPop](https://www.worldpop.org/)** — Global high-resolution population density rasters (GeoTIFF format)
- **[OpenStreetMap via Overpass API](https://overpass-api.de/)** — Real-time road networks, buildings, and points of interest
- **[MapTiler](https://www.maptiler.com/)** — Vector tile hosting and map styles

---

## 🤝 Contributing

Contributions are welcome! Whether you want to tweak infection rates, add new simulation parameters, or improve the UI:

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 🧟 Fun Facts

- The live app title is a reference to **Resident Evil 4** — *"Leon, these residents are evil!"*
- The H3 grid resolution is carefully chosen to balance performance vs. simulation fidelity — too fine and your browser joins the undead
- The `seedrandom` library means two people can share the exact same apocalypse by sharing a seed value
- The simulation runs entirely **client-side** — no backend, no server, just your browser GPU fighting the horde
- Deployed on **Cloudflare Pages** — because even after the apocalypse, the CDN must go on

---

## 📄 License

This project is private. All rights reserved.

---

> *Survive. Adapt. Don't get bitten.*
>
> Built with 🧠 by [Mohid123](https://github.com/Mohid123)
