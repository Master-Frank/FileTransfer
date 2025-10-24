require("dotenv").config();
const path = require("path");
const { default: HtmlPlugin } = require("@rspack/plugin-html");
const CopyPlugin = require("copy-webpack-plugin");
const { getId } = require("@block-kit/utils");

const PUBLIC_PATH = "/";
const RANDOM_ID = getId();
const isDev = process.env.NODE_ENV === "development";

/**
 * @type {import("@rspack/cli").Configuration}
 * @link https://www.rspack.dev/
 */
module.exports = {
  context: __dirname,
  entry: {
    index: "./client/index.tsx",
  },
  externals: {
    "react": "React",
    "react-dom": "ReactDOM",
    "vue": "Vue",
  },
  plugins: [
    new CopyPlugin([{ from: "./client/static", to: "." }]),
    new HtmlPlugin({
      filename: "index.html",
      template: "./client/static/index.html",
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      // Ensure supabase uses browser fetch during bundling
      "@supabase/node-fetch": "cross-fetch",
      // Force cross-fetch to use browser polyfill to avoid node core modules
      "cross-fetch": "cross-fetch/dist/browser-polyfill.js",
    },
  },
  builtins: {
    define: {
      "__DEV__": JSON.stringify(isDev),
      "process.env.RANDOM_ID": JSON.stringify(RANDOM_ID),
      "process.env.PUBLIC_PATH": JSON.stringify(PUBLIC_PATH),
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
      // Supabase client envs
      "process.env.SUPABASE_URL": JSON.stringify(process.env.SUPABASE_URL || ""),
      "process.env.SUPABASE_ANON": JSON.stringify(process.env.SUPABASE_ANON || ""),
      "process.env.SUPABASE_CHANNEL": JSON.stringify(process.env.SUPABASE_CHANNEL || "webrtc-im"),
      // TURN ICE for WebRTC
      "process.env.TURN_ICE": JSON.stringify(process.env.TURN_ICE || ""),
      "import.meta.env.TURN_ICE": JSON.stringify(process.env.TURN_ICE || ""),
    },
    pluginImport: [
      {
        libraryName: "@arco-design/web-react",
        customName: "@arco-design/web-react/es/{{ member }}",
        style: true,
      },
    ],
  },
  module: {
    rules: [
      { test: /\.svg$/, type: "asset" },
      {
        test: /\.(m|module)\.scss$/,
        use: [{ loader: "sass-loader" }],
        type: "css/module",
      },
      {
        test: /\.less$/,
        use: [
          {
            loader: "less-loader",
            options: {
              lessOptions: {
                javascriptEnabled: true,
                importLoaders: true,
                localIdentName: "[name]__[hash:base64:5]",
              },
            },
          },
        ],
        type: "css",
      },
    ],
  },
  target: isDev ? undefined : "es5",
  devtool: isDev ? "source-map" : false,
  output: {
    publicPath: PUBLIC_PATH,
    chunkLoading: "jsonp",
    chunkFormat: "array-push",
    path: path.resolve(__dirname, "build/static"),
    filename: isDev ? "[name].bundle.js" : "[name].[contenthash].js",
    chunkFilename: isDev ? "[name].chunk.js" : "[name].[contenthash].js",
    assetModuleFilename: isDev ? "[name].[ext]" : "[name].[contenthash].[ext]",
  },
  devServer: {
    port: Number(process.env.PORT || 8080),
  },
};
