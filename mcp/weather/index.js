#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const WMO_CODES = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ light hail', 99: 'Thunderstorm w/ heavy hail',
};

function describeWeather(code) {
  return WMO_CODES[code] ?? `Code ${code}`;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status}`);
  return res.json();
}

const server = new McpServer({ name: 'weather-mcp', version: '0.1.0' });

server.registerTool('weather', {
  title: 'Weather',
  description: 'Get current conditions and 7-day forecast for a location. Use geocode first if you only have a city name.',
  inputSchema: {
    latitude: z.number().describe('Latitude'),
    longitude: z.number().describe('Longitude'),
  },
}, async ({ latitude, longitude }) => {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '7',
  });

  const data = await fetchJSON(`https://api.open-meteo.com/v1/forecast?${params}`);
  const c = data.current;
  const d = data.daily;

  let out = `Current (${data.timezone}):\n`;
  out += `  ${describeWeather(c.weather_code)}, ${c.temperature_2m}°C (feels ${c.apparent_temperature}°C)\n`;
  out += `  Humidity ${c.relative_humidity_2m}%, Wind ${c.wind_speed_10m} km/h gusting ${c.wind_gusts_10m} km/h\n\n`;
  out += `7-day forecast:\n`;

  for (let i = 0; i < d.time.length; i++) {
    out += `  ${d.time[i]}: ${describeWeather(d.weather_code[i])}, ${d.temperature_2m_min[i]}–${d.temperature_2m_max[i]}°C, precip ${d.precipitation_sum[i]}mm, wind ${d.wind_speed_10m_max[i]} km/h\n`;
  }

  return { content: [{ type: 'text', text: out.trim() }] };
});

server.registerTool('geocode', {
  title: 'Geocode',
  description: 'Find coordinates for a city/place name. Returns top matches with lat, lon, country.',
  inputSchema: {
    name: z.string().describe('City or place name'),
  },
}, async ({ name }) => {
  const params = new URLSearchParams({ name, count: '3', language: 'en', format: 'json' });
  const data = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?${params}`);

  if (!data.results || data.results.length === 0) {
    return { content: [{ type: 'text', text: `No results found for "${name}".` }] };
  }

  const lines = data.results.map(r =>
    `${r.name}, ${r.admin1 ?? ''} ${r.country} (${r.latitude}, ${r.longitude}, elev ${r.elevation ?? '?'}m)`
  );

  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
