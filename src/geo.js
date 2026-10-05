const EARTH_RADIUS_METRES = 6_371_000;

const toRadians = (value) => (value * Math.PI) / 180;

export function haversineDistance(pointA, pointB) {
  const latitudeDelta = toRadians(pointB.lat - pointA.lat);
  const longitudeDelta = toRadians(pointB.lng - pointA.lng);
  const latitudeA = toRadians(pointA.lat);
  const latitudeB = toRadians(pointB.lat);

  const calculation =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(calculation));
}

function outsideChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLatitude(x, y) {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  result += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return result;
}

function transformLongitude(x, y) {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  result += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return result;
}

export function gcj02ToWgs84({ lat, lng }) {
  if (outsideChina(lat, lng)) return { lat, lng };

  const semiMajorAxis = 6378245;
  const eccentricitySquared = 0.006693421622965943;
  let latitudeOffset = transformLatitude(lng - 105, lat - 35);
  let longitudeOffset = transformLongitude(lng - 105, lat - 35);
  const radianLatitude = toRadians(lat);
  let magic = Math.sin(radianLatitude);
  magic = 1 - eccentricitySquared * magic * magic;
  const squareRootMagic = Math.sqrt(magic);
  latitudeOffset = (latitudeOffset * 180) / (((semiMajorAxis * (1 - eccentricitySquared)) / (magic * squareRootMagic)) * Math.PI);
  longitudeOffset = (longitudeOffset * 180) / ((semiMajorAxis / squareRootMagic) * Math.cos(radianLatitude) * Math.PI);

  const transformedLatitude = lat + latitudeOffset;
  const transformedLongitude = lng + longitudeOffset;
  return { lat: lat * 2 - transformedLatitude, lng: lng * 2 - transformedLongitude };
}

export function evaluateGeofence(position, geo) {
  const accuracy = Number(position.accuracy);
  const centre = geo.coordSystem === "GCJ02" ? gcj02ToWgs84(geo) : { lat: geo.lat, lng: geo.lng };
  const latitude = Number(position.latitude);
  const longitude = Number(position.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { status: "inaccurate", accuracy, distance: null, allowedDistance: geo.radiusM, centre };
  }

  const distance = haversineDistance(
    { lat: latitude, lng: longitude },
    centre
  );
  const reportedAccuracy = Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
  const allowedDistance = geo.radiusM + (reportedAccuracy ?? 0);

  // A low-accuracy fix can be recorded manually only when its uncertainty area
  // could still overlap the attraction. A clearly distant fix must not bypass
  // the geofence through the manual fallback.
  if (reportedAccuracy !== null && distance > allowedDistance) {
    return { status: "too-far", accuracy, distance, allowedDistance, centre };
  }

  if (reportedAccuracy === null || reportedAccuracy > 200) {
    return { status: "inaccurate", accuracy, distance, allowedDistance, centre };
  }

  return {
    status: "verified",
    accuracy,
    distance,
    allowedDistance,
    centre
  };
}

export function formatDistance(distance) {
  if (!Number.isFinite(distance)) return "未知距離";
  if (distance < 1000) return `${Math.round(distance)} 米`;
  return `${(distance / 1000).toFixed(1)} 公里`;
}
