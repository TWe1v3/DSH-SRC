// dsh-src 客户端 bundle
// 在 dsh web 的 conversation.view 插槽中注册「探索图」标签页。
// 由 ClientModuleRegistry 自动发现（package.json 的 dsh.client 声明），
// 浏览器端通过 /plugins/dsh-src/client.js 加载。
//
// 视图内容是一个 iframe，指向宿主端注册的 /src-graph 页面，
// 该页面由 lib/index.js 的 webServer 路由提供。
window.__ModuleLoader__.load({
  id: "dsh-src",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");

    var inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("conversation.view", function () {
        return ctx.slots.register(
          {
            name: "conversation.view",
            id: "src-graph",
            order: 20,
            label: function () { return "探索图"; },
            inject: function (sessionId) {
              return { sessionId: sessionId };
            },
          },
          function SrcGraphView(props) {
            var src = "/src-graph";
            if (props && props.sessionId) {
              src += "?session=" + encodeURIComponent(props.sessionId);
            }
            return React.createElement(
              "div",
              { style: { width: "100%", height: "100%", position: "relative" } },
              React.createElement("iframe", {
                src: src,
                style: {
                  width: "100%",
                  height: "100%",
                  border: "none",
                  position: "absolute",
                  top: 0,
                  left: 0,
                },
                title: "SRC 探索图",
              })
            );
          }
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
