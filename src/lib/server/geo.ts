import proj4 from 'proj4';

proj4.defs(
	'EPSG:5514',
	'+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs'
);

export type SjtskPoint = {
	x: number;
	y: number;
};

export type SjtskPolygonPoint = {
	x: number;
	y: number;
};

export function wgs84ToSjtsk(latitude: number, longitude: number): SjtskPoint {
	const [x, y] = proj4('EPSG:4326', 'EPSG:5514', [longitude, latitude]);

	return {
		x: round2(x),
		y: round2(y)
	};
}

export function createSquarePolygon(center: SjtskPoint, radiusMeters: number): SjtskPolygonPoint[] {
	const radius = Math.max(5, Math.min(radiusMeters, 250));

	return [
		{ x: round2(center.x - radius), y: round2(center.y - radius) },
		{ x: round2(center.x + radius), y: round2(center.y - radius) },
		{ x: round2(center.x + radius), y: round2(center.y + radius) },
		{ x: round2(center.x - radius), y: round2(center.y + radius) },
		{ x: round2(center.x - radius), y: round2(center.y - radius) }
	];
}

export function round2(value: number): number {
	return Math.round(value * 100) / 100;
}