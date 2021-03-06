import {selectAll} from 'hast-util-select';
import * as Hast from 'hast';

export function flatten(svg: Hast.Root) {
	for (const {tagName} of selectAll<Hast.Element>(
		':not(g,rect,circle,path)[transform]',
		svg,
		'svg'
	)) {
		console.warn(
			`flattening tag ${tagName} transform attribute is unsupported`
		);
	}

	for (const group of selectAll<Hast.Element>('g[transform]', svg, 'svg')) {
		flattenGroup(group);
	}

	for (const rect of selectAll<Hast.Element>('rect[transform]', svg, 'svg')) {
		rectToPath(rect);
	}

	for (const circle of selectAll<Hast.Element>(
		'circle[transform]',
		svg,
		'svg'
	)) {
		flattenCircle(circle);
	}

	for (const path of selectAll<Hast.Element>(
		'path[d][transform]',
		svg,
		'svg'
	)) {
		flattenPath(path);
	}

	return svg;
}

function flattenCircle(circle: Hast.Element): void {
	return flattenElements<{x: number; y: number}>({
		element: circle,
		deserialize: ({cx, cy}) => ({
			x: zeroIfUndefined(cx),
			y: zeroIfUndefined(cy)
		}),
		translateFn(ctx, x, y) {
			ctx.x += x;
			ctx.y += y;
		},
		rotateFn(ctx, rotator) {
			const result = rotator(ctx.x, ctx.y);
			ctx.x = result.x;
			ctx.y = result.y;
		},
		serialize(ctx, properties) {
			if (ctx.x === 0) {
				delete properties.cx;
			} else {
				properties.cx = ctx.x.toString();
			}

			if (ctx.y === 0) {
				delete properties.cy;
			} else {
				properties.cy = ctx.y.toString();
			}
		}
	});
}

function flattenPath(path: Hast.Element): void {
	flattenElements<{
		cmds: Array<{cmd: string; args: number[]}>;
		absIndices: Set<number>;
	}>({
		element: path,
		deserialize({d}) {
			const absIndices: Set<number> = new Set();
			// Relative commands in the start of a path are considered absolute
			const cmds = isString(d)
				? [...d.matchAll(/[\s,]*([mzlhvcsqta])(([\s,]*[+-]?[\d.e]+)*)/gi)].map(
						([_a, cmd, args], ind) => {
							if (ind === 0 || cmd === cmd.toUpperCase()) {
								absIndices.add(ind);
							}

							const numberArgs =
								cmd.toUpperCase() === 'A'
									? [
											...args.matchAll(
												/(\d*\.?\d+(e[-+]?\d+)?)[\s,]*(\d*\.?\d+(e[-+]?\d+)?)[\s,]*([+-]?\d*\.?\d+(e[-+]?\d+)?)[\s,]+([01])[\s,]*([01])[\s,]*([+-]?\d*\.?\d+(e[-+]?\d+)?)[\s,]*([+-]?\d*\.?\d+(e[-+]?\d+)?)/gi
											)
									  ]
											.flatMap((result) => [
												result[1],
												result[3],
												result[5],
												result[7],
												result[8],
												result[9],
												result[11]
											])
											.map((arg) => Number(arg))
									: [
											...args.matchAll(/[\s,]*([-+]?\d*\.?\d+(e[-+]?\d+)?)/gi)
									  ].map(([_, string]) => Number(string));

							return {
								cmd,
								args: numberArgs
							};
						}
				  )
				: [];
			return {cmds, absIndices};
		},
		translateFn({cmds, absIndices}, x, y) {
			for (const ind of absIndices) {
				const {cmd, args} = cmds[ind];
				switch (cmd) {
					case 'H':
						for (let i = 0; i < args.length; i++) {
							args[i] += x;
						}

						break;
					case 'V':
						for (let i = 0; i < args.length; i++) {
							args[i] += y;
						}

						break;
					case 'A':
						args[5] += x;
						args[6] += y;
						break;
					default:
						for (let i = 0; i < args.length; ) {
							args[i++] += x;
							args[i++] += y;
						}
				}
			}
		},
		rotateFn({cmds, absIndices}, rotator, angle) {
			let cursorPt = {x: 0, y: 0};
			let firstPt: {x: number; y: number} | null = null;

			const setFirstPt = () => {
				if (firstPt === null) {
					firstPt = {...cursorPt};
				}
			};

			for (const [ind, cmd] of cmds.entries()) {
				// Update cursor point for H & V commands

				switch (cmd.cmd.toUpperCase()) {
					case 'Z':
						if (firstPt !== null) {
							cursorPt = firstPt;
							firstPt = null;
						}

						break;
					default: {
						const cmdX = cmd.args[cmd.args.length - 2];
						const cmdY = cmd.args[cmd.args.length - 1];
						if (cmd.cmd === cmd.cmd.toUpperCase()) {
							cursorPt.x = cmdX;
							cursorPt.y = cmdY;
						} else {
							cursorPt.x += cmdX;
							cursorPt.y += cmdY;
						}

						setFirstPt();
						break;
					}

					case 'H':
					case 'V':
				}

				const flattenHV = (getXY: (arg: number) => [number, number]) => {
					cmd.cmd = 'l';
					cmd.args = cmd.args.flatMap((arg) => {
						const result = rotator(...getXY(arg));
						return [result.x, result.y];
					});
				};

				switch (cmd.cmd) {
					case 'H': {
						const lastX = cmd.args[cmd.args.length - 1];
						const cursorX = cursorPt.x;
						flattenHV((arg) => [arg - cursorX, 0]);
						cursorPt.x = lastX;
						setFirstPt();
						absIndices.delete(ind);
						break;
					}

					case 'h': {
						for (const arg of cmd.args) {
							cursorPt.x += arg;
						}

						flattenHV((arg) => [arg, 0]);
						setFirstPt();
						break;
					}

					case 'V': {
						const lastY = cmd.args[cmd.args.length - 1];
						const cursorY = cursorPt.y;
						flattenHV((arg) => [0, arg - cursorY]);
						cursorPt.y = lastY;
						setFirstPt();
						absIndices.delete(ind);
						break;
					}

					case 'v':
						for (const arg of cmd.args) {
							cursorPt.y += arg;
						}

						flattenHV((arg) => [0, arg]);
						setFirstPt();
						break;
					case 'A':
					case 'a': {
						const result = rotator(cmd.args[5], cmd.args[6]);
						cmd.args[2] += angle;
						cmd.args[5] = result.x;
						cmd.args[6] = result.y;
						break;
					}

					default:
						for (let i = 0; i < cmd.args.length; ) {
							const result = rotator(cmd.args[i], cmd.args[i + 1]);
							cmd.args[i++] = result.x;
							cmd.args[i++] = result.y;
						}
				}
			}
		},
		serialize(ctx, properties) {
			properties.d = ctx.cmds
				.map(({cmd, args}) => `${cmd} ${args.join()}`)
				.join(' ');
		}
	});
}

function flattenElements<T>({
	element,
	deserialize,
	translateFn,
	rotateFn,
	serialize
}: {
	element: Hast.Element;
	deserialize: (properties: Record<string, unknown>) => T;
	translateFn: (ctx: T, x: number, y: number) => void;
	rotateFn: (
		ctx: T,
		rotator: (x: number, y: number) => {x: number; y: number},
		angle: number
	) => void;
	serialize: (ctx: T, properties: Record<string, unknown>) => void;
}): void {
	const ctx = deserialize(element.properties);
	const transformAttribute = isString(element.properties.transform)
		? element.properties.transform
		: '';

	for (const [_, func, args] of Array.from(
		transformAttribute.matchAll(/ *([a-z]+) *\(([^)]*)\) */g)
	).reverse()) {
		switch (func) {
			case 'translate': {
				const translateArgs = /^ *([+-]?[\d.e]*) *,? *([+-]?[\d.e]*)? *$/i.exec(
					args
				);
				if (translateArgs === null) {
					throw new Error(`Invalid translate arguments: ${args}`);
				}

				translateFn(
					ctx,
					Number(translateArgs[1]),
					zeroIfUndefined(translateArgs[2])
				);

				break;
			}

			case 'rotate': {
				const rotateArgs = /^ *([+-]?[\d.e]*) *,? *(([+-]?[\d.e]*) *,? *([+-]?[\d.e]*))? *$/i.exec(
					args
				);
				if (rotateArgs === null) {
					throw new Error(`Invalid rotate arguments: ${args}`);
				}

				const angleDegrees = Number(rotateArgs[1]);
				const angleRad = (angleDegrees * Math.PI) / 180;
				let rotateX: string | number | undefined = rotateArgs[3];

				const s = Math.sin(angleRad);
				const c = Math.cos(angleRad);

				const rotator = (x: number, y: number) => ({
					x: x * c - y * s,
					y: x * s + y * c
				});

				if (rotateX === undefined) {
					rotateFn(ctx, rotator, angleDegrees);
				} else {
					rotateX = Number(rotateX);
					const rotateY = Number(rotateArgs[4]);

					translateFn(ctx, -rotateX, -rotateY);
					rotateFn(ctx, rotator, angleDegrees);
					translateFn(ctx, rotateX, rotateY);
				}

				break;
			}

			default:
				throw new Error(`Unsupported transform function: ${func}`);
		}
	}

	serialize(ctx, element.properties);

	delete element.properties.transform;
}

function zeroIfUndefined(value?: unknown): number {
	return value === undefined ? 0 : Number(value);
}

function flattenGroup(
	element: Hast.Element | Hast.Comment | Hast.Text | Hast.Raw
): void {
	switch (element.type) {
		case 'element': {
			if (!isString(element.properties.transform)) {
				return;
			}

			const transform = element.properties.transform;

			for (const child of element.children.filter(
				(child) => child.properties !== undefined
			) as Hast.Element[]) {
				child.properties.transform = `${transform} ${
					child.properties.transform ?? ''
				}`;
				if (child.tagName === 'g' || child.tagName === 'mask')
					flattenGroup(child);
			}

			delete element.properties.transform;
		}

		case 'comment':
		case 'raw':
		case 'text':
		default:
	}
}

function rectToPath(element: Hast.Element): void {
	element.tagName = 'path';
	const width = zeroIfUndefined(element.properties.width);
	const height = zeroIfUndefined(element.properties.height);
	const rxString = element.properties.rx;
	const ryString = element.properties.ry;
	let rx = 0;
	let ry = 0;
	if (rxString === undefined) {
		if (ryString !== undefined) {
			ry = Number(ryString);
			rx = ry;
		}
	} else {
		rx = Number(rxString);
		ry = ryString === undefined ? rx : Number(ryString);
	}

	const curve = (x: number, y: number) =>
		rx || ry ? `a${rx},${ry},0,0,1,${x},${y}` : '';
	element.properties.d = `M${
		zeroIfUndefined(element.properties.x) + rx
	},${zeroIfUndefined(element.properties.y)}h${width - 2 * rx}${curve(
		rx,
		ry
	)}v${height - 2 * ry}${curve(-rx, ry)}h${2 * rx - width}${curve(-rx, -ry)}${
		rx || ry ? `v${2 * ry - height}` : ''
	}${curve(rx, -ry)}z`;
	delete element.properties.x;
	delete element.properties.y;
	delete element.properties.width;
	delete element.properties.height;
	delete element.properties.rx;
	delete element.properties.ry;
}

function isString(test: unknown): test is string {
	return {}.toString.call(test) === '[object String]';
}
