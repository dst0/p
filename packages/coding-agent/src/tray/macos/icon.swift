import Cocoa

func createTrayIcon(isIndexing: Bool, isError: Bool) -> NSImage {
    let size = NSSize(width: 18, height: 18)
    let image = NSImage(size: size, flipped: false) { _ in
        guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
        let bounds = CGRect(x: 1, y: 1, width: 16, height: 16)

        // Draw outer rounded square container
        let path = CGPath(roundedRect: bounds, cornerWidth: 3.5, cornerHeight: 3.5, transform: nil)
        ctx.addPath(path)
        ctx.setLineWidth(1.3)
        ctx.strokePath()

        // Draw stylized letter 'P'
        let pPath = CGMutablePath()
        pPath.move(to: CGPoint(x: 5.5, y: 4.5))
        pPath.addLine(to: CGPoint(x: 5.5, y: 13.5))
        pPath.addLine(to: CGPoint(x: 9.5, y: 13.5))
        pPath.addArc(center: CGPoint(x: 9.5, y: 10.5), radius: 3.0, startAngle: .pi / 2, endAngle: -.pi / 2, clockwise: true)
        pPath.addLine(to: CGPoint(x: 5.5, y: 7.5))
        ctx.addPath(pPath)
        ctx.setLineWidth(1.4)
        ctx.strokePath()

        if isIndexing {
            // Draw active indexing pulse dot on top right
            ctx.setFillColor(CGColor(gray: 0.1, alpha: 1.0))
            ctx.fillEllipse(in: CGRect(x: 12.0, y: 12.0, width: 4.0, height: 4.0))
        } else if isError {
            // Draw warning slash
            ctx.move(to: CGPoint(x: 13.0, y: 3.5))
            ctx.addLine(to: CGPoint(x: 15.0, y: 1.5))
            ctx.strokePath()
        }
        return true
    }
    image.isTemplate = true
    return image
}
