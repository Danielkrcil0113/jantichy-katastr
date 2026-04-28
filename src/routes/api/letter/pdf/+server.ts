import { error, type RequestHandler } from '@sveltejs/kit';
import {
	PDFDocument,
	PDFFont,
	PDFPage,
	rgb,
	type Color
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LetterPdfPayload, LetterVariant } from '$lib/types';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const COLORS = {
	black: rgb(0.08, 0.09, 0.11),
	gray: rgb(0.35, 0.39, 0.45),
	lightGray: rgb(0.94, 0.95, 0.97),
	blue: rgb(0.1, 0.32, 0.72),
	blueDark: rgb(0.04, 0.17, 0.42),
	blueLight: rgb(0.9, 0.95, 1),
	green: rgb(0.05, 0.45, 0.25),
	cream: rgb(0.99, 0.96, 0.9),
	creamDark: rgb(0.52, 0.33, 0.12),
	gold: rgb(0.82, 0.58, 0.2),
	white: rgb(1, 1, 1)
};

type PdfContext = {
	pdfDoc: PDFDocument;
	page: PDFPage;
	regularFont: PDFFont;
	boldFont: PDFFont;
	variant: LetterVariant;
	y: number;
	marginLeft: number;
	marginRight: number;
	bottomMargin: number;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function getVariant(value: unknown): LetterVariant {
	if (value === 'classic' || value === 'modern' || value === 'premium') {
		return value;
	}

	return 'classic';
}

function sanitizeFileName(value: string): string {
	const cleaned = value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9-_]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.toLowerCase();

	return cleaned || 'nabidka-odkupu';
}

async function loadFonts(pdfDoc: PDFDocument) {
	pdfDoc.registerFontkit(fontkit as unknown as Parameters<typeof pdfDoc.registerFontkit>[0]);

	const regularPath = path.join(
		process.cwd(),
		'node_modules',
		'@fontsource',
		'noto-sans',
		'files',
		'noto-sans-latin-ext-400-normal.woff'
	);

	const boldPath = path.join(
		process.cwd(),
		'node_modules',
		'@fontsource',
		'noto-sans',
		'files',
		'noto-sans-latin-ext-700-normal.woff'
	);

	const [regularBytes, boldBytes] = await Promise.all([readFile(regularPath), readFile(boldPath)]);

	const regularFont = await pdfDoc.embedFont(regularBytes, { subset: true });
	const boldFont = await pdfDoc.embedFont(boldBytes, { subset: true });

	return { regularFont, boldFont };
}

function createPage(pdfDoc: PDFDocument, variant: LetterVariant): PDFPage {
	const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

	if (variant === 'modern') {
		page.drawRectangle({
			x: 0,
			y: 0,
			width: 46,
			height: A4_HEIGHT,
			color: COLORS.blueDark
		});

		page.drawRectangle({
			x: 46,
			y: A4_HEIGHT - 96,
			width: A4_WIDTH - 46,
			height: 96,
			color: COLORS.blueLight
		});
	}

	if (variant === 'premium') {
		page.drawRectangle({
			x: 0,
			y: 0,
			width: A4_WIDTH,
			height: A4_HEIGHT,
			color: COLORS.cream
		});

		page.drawRectangle({
			x: 34,
			y: 34,
			width: A4_WIDTH - 68,
			height: A4_HEIGHT - 68,
			borderColor: COLORS.gold,
			borderWidth: 1.2
		});
	}

	return page;
}

function getMargins(variant: LetterVariant) {
	if (variant === 'modern') {
		return {
			marginLeft: 84,
			marginRight: 52,
			bottomMargin: 60,
			startY: A4_HEIGHT - 150
		};
	}

	if (variant === 'premium') {
		return {
			marginLeft: 72,
			marginRight: 72,
			bottomMargin: 72,
			startY: A4_HEIGHT - 190
		};
	}

	return {
		marginLeft: 62,
		marginRight: 62,
		bottomMargin: 62,
		startY: A4_HEIGHT - 125
	};
}

function drawHeader(ctx: PdfContext, payload: LetterPdfPayload) {
	const title = 'Nezávazná nabídka odkupu pozemku';
	const date = new Intl.DateTimeFormat('cs-CZ', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(new Date());

	if (ctx.variant === 'classic') {
		ctx.page.drawText(title, {
			x: ctx.marginLeft,
			y: A4_HEIGHT - 70,
			size: 18,
			font: ctx.boldFont,
			color: COLORS.black
		});

		ctx.page.drawText(date, {
			x: A4_WIDTH - ctx.marginRight - ctx.regularFont.widthOfTextAtSize(date, 9),
			y: A4_HEIGHT - 68,
			size: 9,
			font: ctx.regularFont,
			color: COLORS.gray
		});

		ctx.page.drawLine({
			start: { x: ctx.marginLeft, y: A4_HEIGHT - 92 },
			end: { x: A4_WIDTH - ctx.marginRight, y: A4_HEIGHT - 92 },
			thickness: 0.8,
			color: COLORS.gray
		});

		return;
	}

	if (ctx.variant === 'modern') {
		ctx.page.drawText('NABÍDKA', {
			x: ctx.marginLeft,
			y: A4_HEIGHT - 62,
			size: 9,
			font: ctx.boldFont,
			color: COLORS.blue
		});

		ctx.page.drawText(title, {
			x: ctx.marginLeft,
			y: A4_HEIGHT - 88,
			size: 20,
			font: ctx.boldFont,
			color: COLORS.blueDark
		});

		ctx.page.drawText(date, {
			x: ctx.marginLeft,
			y: A4_HEIGHT - 112,
			size: 9,
			font: ctx.regularFont,
			color: COLORS.gray
		});

		drawInfoBox(ctx, payload, A4_HEIGHT - 178, COLORS.white, COLORS.blue);

		return;
	}

	ctx.page.drawText('Soukromá nabídka odkupu', {
		x: ctx.marginLeft,
		y: A4_HEIGHT - 82,
		size: 10,
		font: ctx.boldFont,
		color: COLORS.creamDark
	});

	ctx.page.drawText(title, {
		x: ctx.marginLeft,
		y: A4_HEIGHT - 112,
		size: 21,
		font: ctx.boldFont,
		color: COLORS.black
	});

	ctx.page.drawText(date, {
		x: ctx.marginLeft,
		y: A4_HEIGHT - 135,
		size: 9,
		font: ctx.regularFont,
		color: COLORS.gray
	});

	drawInfoBox(ctx, payload, A4_HEIGHT - 202, rgb(1, 0.98, 0.93), COLORS.gold);
}

function drawInfoBox(
	ctx: PdfContext,
	payload: LetterPdfPayload,
	y: number,
	background: Color,
	accent: Color
) {
	const x = ctx.marginLeft;
	const width = A4_WIDTH - ctx.marginLeft - ctx.marginRight;
	const height = 54;

	ctx.page.drawRectangle({
		x,
		y,
		width,
		height,
		color: background,
		borderColor: accent,
		borderWidth: 0.8
	});

	ctx.page.drawText('Pozemek', {
		x: x + 14,
		y: y + 32,
		size: 8,
		font: ctx.boldFont,
		color: COLORS.gray
	});

	const parcelText = truncateText(payload.parcelSummary || 'Bez vybrané parcely', ctx.regularFont, 8.5, width - 28);

	ctx.page.drawText(parcelText, {
		x: x + 14,
		y: y + 17,
		size: 8.5,
		font: ctx.regularFont,
		color: COLORS.black
	});

	if (payload.offerAmount) {
		const amountLabel = `Nabídka: ${payload.offerAmount}`;
		const amountWidth = ctx.boldFont.widthOfTextAtSize(amountLabel, 9);

		ctx.page.drawText(amountLabel, {
			x: x + width - amountWidth - 14,
			y: y + 32,
			size: 9,
			font: ctx.boldFont,
			color: accent
		});
	}
}

function truncateText(text: string, font: PDFFont, size: number, maxWidth: number): string {
	if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;

	let output = text;

	while (output.length > 0 && font.widthOfTextAtSize(`${output}…`, size) > maxWidth) {
		output = output.slice(0, -1);
	}

	return `${output}…`;
}

function ensureSpace(ctx: PdfContext, lineHeight: number) {
	if (ctx.y - lineHeight >= ctx.bottomMargin) return;

	const margins = getMargins(ctx.variant);
	ctx.page = createPage(ctx.pdfDoc, ctx.variant);
	ctx.y = margins.startY;

	if (ctx.variant !== 'classic') {
		ctx.y = A4_HEIGHT - 92;
	}
}

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);

	if (words.length === 0) return [''];

	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		const attempt = current ? `${current} ${word}` : word;

		if (font.widthOfTextAtSize(attempt, size) <= maxWidth) {
			current = attempt;
			continue;
		}

		if (current) {
			lines.push(current);
			current = word;
		} else {
			lines.push(word);
			current = '';
		}
	}

	if (current) lines.push(current);

	return lines;
}

function drawWrappedText(
	ctx: PdfContext,
	text: string,
	options?: {
		size?: number;
		lineHeight?: number;
		color?: Color;
		x?: number;
		maxWidth?: number;
	}
) {
	const size = options?.size ?? 10.5;
	const lineHeight = options?.lineHeight ?? 16;
	const color = options?.color ?? COLORS.black;
	const x = options?.x ?? ctx.marginLeft;
	const maxWidth = options?.maxWidth ?? A4_WIDTH - ctx.marginLeft - ctx.marginRight;

	const paragraphs = text.replace(/\r/g, '').split('\n');

	for (const paragraph of paragraphs) {
		if (!paragraph.trim()) {
			ctx.y -= lineHeight * 0.7;
			continue;
		}

		const lines = wrapLine(paragraph, ctx.regularFont, size, maxWidth);

		for (const line of lines) {
			ensureSpace(ctx, lineHeight);

			ctx.page.drawText(line, {
				x,
				y: ctx.y,
				size,
				font: ctx.regularFont,
				color
			});

			ctx.y -= lineHeight;
		}
	}
}

function drawFooter(pdfDoc: PDFDocument, font: PDFFont, variant: LetterVariant) {
	const pages = pdfDoc.getPages();

	pages.forEach((page, index) => {
		const pageNumber = `${index + 1} / ${pages.length}`;

		const color = variant === 'modern' ? COLORS.blue : variant === 'premium' ? COLORS.creamDark : COLORS.gray;

		page.drawText(pageNumber, {
			x: A4_WIDTH - 84,
			y: 34,
			size: 8,
			font,
			color
		});
	});
}

async function createPdf(payload: LetterPdfPayload): Promise<Uint8Array> {
	const pdfDoc = await PDFDocument.create();
	const { regularFont, boldFont } = await loadFonts(pdfDoc);

	pdfDoc.setTitle('Nezávazná nabídka odkupu pozemku');
	pdfDoc.setAuthor(payload.buyerName || 'Katastr aplikace');
	pdfDoc.setSubject(payload.parcelSummary || 'Nabídka odkupu pozemku');
	pdfDoc.setCreationDate(new Date());

	const margins = getMargins(payload.variant);
	const firstPage = createPage(pdfDoc, payload.variant);

	const ctx: PdfContext = {
		pdfDoc,
		page: firstPage,
		regularFont,
		boldFont,
		variant: payload.variant,
		y: margins.startY,
		marginLeft: margins.marginLeft,
		marginRight: margins.marginRight,
		bottomMargin: margins.bottomMargin
	};

	drawHeader(ctx, payload);

	drawWrappedText(ctx, payload.letterText, {
		size: payload.variant === 'premium' ? 10.2 : 10.5,
		lineHeight: payload.variant === 'premium' ? 16.5 : 16,
		color: COLORS.black
	});

	drawFooter(pdfDoc, regularFont, payload.variant);

	return pdfDoc.save();
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		error(400, 'Neplatný JSON v požadavku.');
	}

	if (!isRecord(body)) {
		error(400, 'Neplatná data pro PDF.');
	}

	const variant = getVariant(body.variant);
	const letterText = getString(body.letterText).trim();

	if (!letterText) {
		error(400, 'Chybí text dopisu.');
	}

	if (letterText.length > 12000) {
		error(400, 'Text dopisu je příliš dlouhý.');
	}

	const payload: LetterPdfPayload = {
		variant,
		letterText,
		parcelSummary: getString(body.parcelSummary),
		recipientName: getString(body.recipientName),
		buyerName: getString(body.buyerName),
		offerAmount: getString(body.offerAmount),
		fileName: sanitizeFileName(getString(body.fileName, 'nabidka-odkupu'))
	};

	try {
		const pdfBytes = await createPdf(payload);

		return new Response(Buffer.from(pdfBytes), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${payload.fileName}.pdf"`,
				'Cache-Control': 'no-store'
			}
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'PDF se nepodařilo vygenerovat.';
		error(500, message);
	}
};