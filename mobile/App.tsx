import { StatusBar } from "expo-status-bar";
import React from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

function safeRun(fn: () => Promise<void>) {
  return fn().catch((e) => {
    console.error(e);
  });
}

export default function App() {
  const html = require("./bundle.json");
  let ref = React.useRef<WebView>(null);
  return (
    <SafeAreaView style={styles.container}>
      <Text
        style={{
          color: "#fff",
          backgroundColor: "#333",
          height: 40,
        }}
        onPress={() => {
          ref.current?.injectJavaScript('receiveMessage("Sup");');
        }}
      >
        This is a header
      </Text>
      <WebView
        style={styles.container}
        ref={ref}
        originWhitelist={["*"]}
        source={{ html: html.html }}
        onMessage={(event) => {
          console.log("Got event", event.nativeEvent.data);
        }}
      />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
