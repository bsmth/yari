// @ts-nocheck
import { fileURLToPath } from "node:url";
// TODO: fix nodeExternals (see note below, where it was used)
// import nodeExternals from "webpack-node-externals";
import webpack from "webpack";
import crypto from "node:crypto";
import path from "node:path";
import { BASE_URL } from "../libs/env/index.js";
import paths from "../client/config/paths.js";

class PrintCSPHashForInlineAssets {
  /**
   * @param {import("webpack").Compiler} compiler
   */
  apply(compiler) {
    compiler.hooks.compilation.tap("GenerateCSPHash", (compilation) => {
      compilation.hooks.succeedModule.tap("GenerateCSPHash", (module) => {
        const fileName = module.resource;
        if (fileName?.endsWith("?inline")) {
          const source = module.originalSource().source();
          const algo = "sha256";
          const hash = crypto.createHash(algo).update(source).digest("base64");
          console.log(`CSP hash for ${fileName}: '${algo}-${hash}'`);
        }
      });
    });
  }
}

const SSR_OUTPUT = fileURLToPath(new URL("dist", import.meta.url));

const config = {
  context: fileURLToPath(new URL(".", import.meta.url)),
  entry: "./index.ts",
  output: {
    path: SSR_OUTPUT,
    filename: "[name].js",
    sourceMapFilename: "[name].js.map",
    library: { type: "module" },
    chunkFormat: "module",
  },
  target: "node",
  node: false,
  // See all options here:
  // https://webpack.js.org/configuration/stats/
  stats: "errors-warnings",
  resolve: {
    modules: ["node_modules", "src"],
    extensions: ["*", ".js", ".json", ".ts", ".tsx"],
  },
  module: {
    rules: [
      {
        oneOf: [
          {
            // allow assets to be put in root of site, rather than `/static/media/`
            // TODO: we may want to put most things in `/static/media/` but this keeps
            // the diff minimal
            resourceQuery: /public/, // e.g. `import("./foobar?public")`
            type: "asset/resource",
            generator: {
              emit: true,
              publicPath: BASE_URL.replace(/\/?$/, "/") || "/",
              filename: "[name].[hash][ext]",
              outputPath: path.relative(SSR_OUTPUT, paths.appBuild), // relative to output.path set above
            },
          },
          {
            // allow assets to be rendered inline
            // will also have a CSP hash generated by `GenerateCSPHash`
            resourceQuery: /inline/, // e.g. `import("./foobar?inline")`
            type: "asset/source",
            rules: [
              {
                test: /\.js$/,
                use: ["terser-loader"],
              },
              {
                test: /\.css$/,
                use: [
                  {
                    loader: "postcss-loader",
                    options: {
                      postcssOptions: {
                        config: false,
                        plugins: ["cssnano"],
                      },
                    },
                  },
                ],
              },
            ],
          },
          {
            // now our "normal", client-side emulating module rules
            // TODO: deduplicate with client webpack config
            oneOf: [
              {
                resourceQuery: /raw/,
                type: "asset/source",
              },
              {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: [
                  {
                    loader: "ts-loader",
                    options: {
                      transpileOnly: true,
                    },
                  },
                ],
              },
              {
                test: /\.svg$/,
                use: [
                  {
                    loader: "@svgr/webpack",
                    options: {
                      prettier: false,
                      svgo: false,
                      svgoConfig: {
                        plugins: [{ removeViewBox: false }],
                      },
                      titleProp: true,
                      ref: true,
                    },
                  },
                  {
                    loader: "file-loader",
                    options: {
                      emitFile: false,
                      publicPath: "/",
                      name: "static/media/[name].[hash].[ext]",
                    },
                  },
                ],
                issuer: {
                  and: [/\.(ts|tsx|js|jsx|md|mdx)$/],
                },
              },
              {
                test: [/\.avif$/, /\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/],
                type: "asset",
                parser: {
                  dataUrlCondition: {
                    maxSize: 0,
                  },
                },
                generator: {
                  emit: false,
                  publicPath: "/",
                  filename: "static/media/[name].[hash][ext]",
                },
              },
              { test: /\.(css|scss)$/, loader: "ignore-loader" },
            ],
          },
        ],
      },
    ],
  },
  // // TODO/BUG: this was never working, when we did `cd ssr && webpack`
  // // but now we do `webpack --config ssr/webpack.config.js` the yari
  // // node_modules dir gets picked up, and all of that stuff is `require()`ed
  // // which then makes `dist/main.js` no longer a ESM-compatible module.
  // // In the future we *do* want to do something like this, because it's faster
  // // (8s vs 23s) but for now it would break creating a self-contained
  // // `dist/main.js` file, which we should probably do with another tool (esbuild?).
  // // Anyway... that's for a future incremental improvement to the client build system:
  // externals: nodeExternals(),
  devtool: "source-map",
  plugins: [
    // This makes is so that there is only one `ssr/dist/main.js` (and
    // `ssr/dis/main.js.map`) file. There's no point in code splitting the
    // code that is run by Node. Code splitting is something that we do to benefit
    // users who consume our code through a browser.
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1,
    }),
    new PrintCSPHashForInlineAssets(),
  ],
  experiments: {
    outputModule: true,
  },
};

export default config;
