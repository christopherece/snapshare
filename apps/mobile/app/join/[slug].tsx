import { Redirect, useLocalSearchParams } from "expo-router";

/** Deep link target for QR codes: snapshare://join/<slug> or https://snapshare.app/join/<slug> */
export default function JoinLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={{ pathname: "/", params: { slug } }} />;
}
