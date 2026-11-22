import SwiftUI

/// The mini player on the tab bar: artwork, title, play/pause. Tap to open the full player.
struct MiniPlayer: View {
    var onOpen: () -> Void
    @State private var player = AudioPlayer.shared
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        if let ep = player.current {
            HStack(spacing: 10) {
                Artwork(path: ep.artworkUrl, size: 30)
                    .clipShape(.rect(cornerRadius: 7))
                Text(ep.title).textStyle(.preview, medium: true, color: .ink).lineLimit(1)
                Spacer(minLength: 6)
                Button { player.toggle() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 17))
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                if placement != .inline {
                    Button { ep.isPodcast ? player.skip(30) : player.next() } label: {
                        Image(systemName: ep.isPodcast ? "goforward.30" : "forward.fill")
                            .font(.system(size: 15))
                            .frame(width: 32, height: 36)
                    }
                    .accessibilityLabel(ep.isPodcast ? "Forward 30 seconds" : "Next")
                }
            }
            .foregroundStyle(Color.ink)
            .padding(.leading, 10)
            .padding(.trailing, 6)
            .contentShape(.rect)
            .onTapGesture(perform: onOpen)
        }
    }
}

/// The full player: artwork, title, scrubber, transport, speed.
struct NowPlayingSheet: View {
    @State private var player = AudioPlayer.shared
    @State private var scrubbing: Double?
    @Environment(\.dismiss) private var dismiss

    private let speeds: [Float] = [0.8, 1, 1.2, 1.5, 1.75, 2]

    var body: some View {
        VStack(spacing: 0) {
            if let ep = player.current {
                Spacer(minLength: 20)
                Artwork(path: ep.artworkUrl, size: 280)
                    .scaleEffect(player.isPlaying ? 1 : 0.9)
                    .animation(.spring(duration: 0.4, bounce: 0.25), value: player.isPlaying)
                Spacer(minLength: 24)
                VStack(spacing: 4) {
                    Text(ep.title).textStyle(.section, medium: true, color: .ink).lineLimit(2).multilineTextAlignment(.center)
                    if let show = ep.show { Text(show).textStyle(.control, color: .mutedText) }
                }
                .padding(.horizontal, 24)

                VStack(spacing: 6) {
                    Slider(value: Binding(get: { scrubbing ?? player.position }, set: { scrubbing = $0 }),
                           in: 0...max(player.duration, 1)) { editing in
                        if !editing, let s = scrubbing { player.seek(to: s); scrubbing = nil }
                    }
                    .tint(.ink)
                    HStack {
                        Text(Episode.time(scrubbing ?? player.position))
                        Spacer()
                        Text("-" + Episode.time(max(0, player.duration - (scrubbing ?? player.position))))
                    }
                    .font(.geistMono(size: 12))
                    .foregroundStyle(Color.mutedText)
                }
                .padding(.horizontal, 28)
                .padding(.top, 26)

                HStack {
                    control("backward.end.fill", "Previous", size: 22) { player.previous() }
                    Spacer()
                    control("gobackward.15", "Back 15 seconds", size: 26) { player.skip(-15) }
                    Spacer()
                    Button { player.toggle() } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(Color.onSolid)
                            .contentTransition(.symbolEffect(.replace))
                            .frame(width: 76, height: 76)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .tint(.ink)
                    .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                    Spacer()
                    control("goforward.30", "Forward 30 seconds", size: 26) { player.skip(30) }
                    Spacer()
                    control("forward.end.fill", "Next", size: 22) { player.next() }
                }
                .padding(.horizontal, 28)
                .padding(.top, 22)

                HStack {
                    Menu {
                        Picker("Speed", selection: $player.speed) {
                            ForEach(speeds, id: \.self) { Text(speedLabel($0)).tag($0) }
                        }
                    } label: {
                        Text(speedLabel(player.speed))
                            .font(.geist(.preview, medium: true))
                            .frame(minWidth: 52, minHeight: 36)
                    }
                    .buttonStyle(.glass)
                    Spacer()
                    if !player.queue.isEmpty {
                        Text("\(player.index + 1) of \(player.queue.count)").textStyle(.meta, color: .mutedText)
                    }
                    Spacer()
                    Button {
                        player.stop()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark").frame(width: 36, height: 36)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .accessibilityLabel("Close player")
                }
                .foregroundStyle(Color.ink)
                .padding(.horizontal, 24)
                .padding(.top, 26)
                .padding(.bottom, 12)
            }
        }
        .presentationDragIndicator(.visible)
        .onChange(of: player.current == nil) { _, gone in if gone { dismiss() } }
    }

    private func speedLabel(_ s: Float) -> String {
        s == 1 ? "1×" : String(format: "%g×", s)
    }

    private func control(_ symbol: String, _ label: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: size)).frame(width: 48, height: 48)
        }
        .foregroundStyle(Color.ink)
        .accessibilityLabel(label)
    }
}
