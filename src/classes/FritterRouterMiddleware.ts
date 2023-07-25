//
// Imports
//

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { FritterContext, FritterMiddlewareFunction, HTTPMethod } from "@fritter/core";
import { pathToRegexp, Key, ParseOptions, TokensToRegexpOptions } from "path-to-regexp";

//
// Class
//

/** Extensions to the FritterContext made by the FritterRouterMiddleware. */
export interface FritterRouterContext extends FritterContext
{
	/** The parameters extracted from the route's path. */
	routeParameters : { [key : string] : string };
}

/** Options for a FritterRouterMiddleware instance. */
export interface FritterRouterMiddlewareOptions
{
	/** Options passed to the path-to-regexp library this middleware uses. */
	pathToRegexpOptions? : TokensToRegexpOptions & ParseOptions;
}

/** A route that the FritterRouterMiddleware can route requests to. */
export interface FritterRouterRoute
{
	/** The HTTP method of the route. */
	method : HTTPMethod | "ALL";

	/** The path of the route. */
	path : string;

	/** Middleware to execute before the handler. */
	middlewares? : FritterMiddlewareFunction[];

	/** The handler for the route. */
	handler : FritterMiddlewareFunction;
}

/** A middleware that handles routing requests to the correct handler. */
export class FritterRouterMiddleware
{
	/** The middleware function that executes the routing logic. */
	public readonly execute : FritterMiddlewareFunction<FritterRouterContext>;

	/** The routes this middleware will use to route requests. */
	protected readonly routes : FritterRouterRoute[] = [];

	/**
	 * Creates a new FritterRouterMiddleware instance.
	 *
	 * @param options Options for the middleware.
	 */
	public constructor(options : FritterRouterMiddlewareOptions = {})
	{
		this.execute = async (fritterContext : FritterRouterContext, next) =>
		{
			//
			// Initialise Fritter Context
			//

			fritterContext.routeParameters = {};

			//
			// Attempt to Match Route
			//

			for (const route of this.routes)
			{
				//
				// Check Method
				//

				if (route.method != "ALL" && route.method != fritterContext.fritterRequest.getHttpMethod())
				{
					continue;
				}

				//
				// Convert Path to RegExp
				//

				const rawRouteParameters : Key[] = [];

				const regExp = pathToRegexp(route.path, rawRouteParameters, options.pathToRegexpOptions);

				//
				// Try to Match Path
				//

				const matches = regExp.exec(fritterContext.fritterRequest.getPath());

				if (matches == null)
				{
					continue;
				}

				//
				// Add Route Parameters to Fritter Context
				//

				for (const [ matchIndex, match ] of matches.slice(1).entries())
				{
					const rawRouteParameter = rawRouteParameters[matchIndex];

					if (rawRouteParameter != null)
					{
						fritterContext.routeParameters[rawRouteParameter.name] = decodeURIComponent(match);
					}
				}

				//
				// Execute Route
				//

				let currentIndex = -1;

				const middlewares =
					[
						...route.middlewares ?? [],
						route.handler,
					];

				const executeMiddleware = async () =>
				{
					currentIndex += 1;

					const nextMiddleware = middlewares[currentIndex];

					if (nextMiddleware != null)
					{
						await nextMiddleware(fritterContext, executeMiddleware);
					}
					else
					{
						await next();
					}
				};

				await executeMiddleware();

				return;
			}

			//
			// Execute Next Middleware
			//

			await next();
		};
	}

	/**
	 * Adds a route to the router.
	 *
	 * @param route The route to add.
	 */
	public addRoute(route : FritterRouterRoute) : void
	{
		this.routes.push(route);
	}

	/** Gets the routes this router is using. */
	public getRoutes() : FritterRouterRoute[]
	{
		return this.routes;
	}

	/**
	 * Attempts to load a route from the given JavaScript file.
	 *
	 * @deprecated Use loadRoutesFile instead.
	 */
	public async loadRoute(jsFilePath : string) : Promise<FritterRouterRoute | null>
	{
		const routeContainer = await import(url.pathToFileURL(jsFilePath).toString()) as { fritterRouterRoute? : FritterRouterRoute };

		if (routeContainer.fritterRouterRoute == null)
		{
			return null;
		}

		this.addRoute(routeContainer.fritterRouterRoute);

		return routeContainer.fritterRouterRoute;
	}

	/** Attempts to load routes from the given JavaScript file. */
	public async loadRoutesFile(jsFilePath : string) : Promise<FritterRouterRoute[]>
	{
		const routeContainer = await import(url.pathToFileURL(jsFilePath).toString()) as
			{
				fritterRouterRoute? : FritterRouterRoute,
				fritterRouterRoutes? : FritterRouterRoute[],
			};

		if (routeContainer.fritterRouterRoute == null && routeContainer.fritterRouterRoutes == null)
		{
			return [];
		}

		const routes : FritterRouterRoute[] = [];

		if (routeContainer.fritterRouterRoute != null)
		{
			routes.push(routeContainer.fritterRouterRoute);

			this.addRoute(routeContainer.fritterRouterRoute);
		}

		if (routeContainer.fritterRouterRoutes != null)
		{
			for (const route of routeContainer.fritterRouterRoutes)
			{
				routes.push(route);

				this.addRoute(route);
			}
		}

		return routes;
	}

	/** Recursively loads all routes in the given directory. */
	public async loadRoutesDirectory(directoryPath : string) : Promise<FritterRouterRoute[]>
	{
		const directoryRoutes : FritterRouterRoute[] = [];

		const directoryEntries = await fs.promises.readdir(directoryPath,
			{
				withFileTypes: true,
			});

		for (const directoryEntry of directoryEntries)
		{
			const directoryEntryPath = path.join(directoryPath, directoryEntry.name);

			if (directoryEntry.isDirectory())
			{
				const subdirectoryRoutes = await this.loadRoutesDirectory(directoryEntryPath);

				directoryRoutes.push(...subdirectoryRoutes);
			}
			else
			{
				const parsedPath = path.parse(directoryEntryPath);

				if (parsedPath.ext != ".js")
				{
					continue;
				}

				const directoryRoutes = await this.loadRoutesFile(directoryEntryPath);

				directoryRoutes.push(...directoryRoutes);
			}
		}

		return directoryRoutes;
	}

	/**
	 * Removes a route from the router.
	 *
	 * @param route The route to remove.
	 */
	public removeRoute(route : FritterRouterRoute) : void
	{
		const index = this.routes.indexOf(route);

		if (index !== -1)
		{
			this.routes.splice(index, 1);
		}
	}
}