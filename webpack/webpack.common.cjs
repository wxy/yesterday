const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const I18nPlugin = require('./plugins/i18n-plugin');

module.exports = {
  entry: {
    background: path.resolve(__dirname, '..', 'src', 'background', 'background.ts'),
    popup: path.resolve(__dirname, '..', 'src', 'popup', 'popup.ts'),
    options: path.resolve(__dirname, '..', 'src', 'options', 'options.ts'),
    content: path.resolve(__dirname, '..', 'src', 'content', 'content.ts'),
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(jpg|jpeg|png|gif|svg|ico)$/i,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx', '.json'],
    
    // 这是关键配置 - 告诉webpack如何将.js扩展名映射到源文件
    extensionAlias: {
      '.js': ['.tsx', '.ts', '.jsx', '.js', '.json']
    }
  },
  plugins: [
    new CleanWebpackPlugin({
      cleanStaleWebpackAssets: false,
    }),
    new I18nPlugin({
      srcDir: path.resolve(__dirname, '..', 'src'),
      outputDir: path.resolve(__dirname, '..', 'dist', '_locales'),
      tempOutputDir: path.resolve(__dirname, '..', 'src', '_locales'),
      defaultLang: 'zh_CN',
      patterns: ['**/*.ts', '**/*.tsx', '**/*.html', '**/*.htm'],
      exclude: ['node_modules', 'dist', '_locales', '.git', 'webpack']
    }),
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, '..', 'src', 'manifest.json'),
          to: path.resolve(__dirname, '..', 'dist'),
          transform: (content) => {
            // 可以在这里修改manifest.json
            return content;
          },
        },
        {
          from: path.resolve(__dirname, '..', 'src', 'assets'),
          to: path.resolve(__dirname, '..', 'dist', 'assets'),
          noErrorOnMissing: true,
        },
        {
          from: path.resolve(__dirname, '..', 'src', '_locales'),
          to: path.resolve(__dirname, '..', 'dist', '_locales')
        },
      ],
    }),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '..', 'src', 'popup', 'popup.html'),
      filename: 'popup/popup.html',
      chunks: ['popup'],
      cache: false,
    }),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '..', 'src', 'options', 'options.html'),
      filename: 'options/options.html',
      chunks: ['options'],
      cache: false,
    }),
  ],
  output: {
    filename: '[name]/[name].js',
    path: path.resolve(__dirname, '..', 'dist'),
    clean: true,
  },
};