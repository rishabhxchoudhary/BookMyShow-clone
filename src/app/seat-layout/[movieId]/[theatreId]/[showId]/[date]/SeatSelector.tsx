"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Movie, SeatMap, HoldResponse } from "@/lib/types";

interface SeatSelectorProps {
  movie: Movie;
  seatMap: SeatMap;
  movieId: string;
  theatreId: string;
  showId: string;
  date: string;
}

export function SeatSelector({
  movie,
  seatMap,
  movieId,
  theatreId,
  showId,
  date,
}: SeatSelectorProps) {
  const router = useRouter();
  const [ticketCount, setTicketCount] = useState(2);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [showTicketModal, setShowTicketModal] = useState(true);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [hold, setHold] = useState<HoldResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Customer form state
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const unavailableSeats = new Set([
    ...seatMap.unavailableSeatIds,
    ...seatMap.heldSeatIds,
  ]);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const now = new Date();
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
      setTimeLeft(diff);

      if (diff === 0) {
        setError("Your hold has expired. Please select seats again.");
        setHold(null);
        setSelectedSeats([]);
        setExpiresAt(null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleSeatClick = (seatId: string) => {
    if (unavailableSeats.has(seatId)) return;
    if (hold) return; // Can't change seats once held

    setSelectedSeats((prev) => {
      if (prev.includes(seatId)) {
        return prev.filter((s) => s !== seatId);
      }
      if (prev.length >= ticketCount) {
        return [...prev.slice(1), seatId];
      }
      return [...prev, seatId];
    });
  };

  const createHold = async () => {
    if (selectedSeats.length !== ticketCount) {
      setError(`Please select ${ticketCount} seats`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showId,
          seatIds: selectedSeats,
          quantity: ticketCount,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          setError("Please sign in to book tickets");
          return;
        }
        setError(data.error?.message ?? "Failed to hold seats");
        return;
      }

      setHold(data);
      setExpiresAt(new Date(data.expiresAt));
      setShowCustomerModal(true);
    } catch (err) {
      setError("Failed to hold seats. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const releaseHold = useCallback(async () => {
    if (!hold) return;

    try {
      await fetch(`/api/v1/holds/${hold.holdId}/release`, {
        method: "POST",
      });
    } catch (err) {
      console.error("Failed to release hold:", err);
    }

    setHold(null);
    setSelectedSeats([]);
    setExpiresAt(null);
  }, [hold]);

  const createOrder = async () => {
    if (!hold) return;

    if (!customerName || !customerEmail || !customerPhone) {
      setError("Please fill in all customer details");
      return;
    }

    if (!/^\d{10}$/.test(customerPhone)) {
      setError("Please enter a valid 10-digit phone number");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdId: hold.holdId,
          customer: {
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message ?? "Failed to create order");
        return;
      }

      router.push(`/order-summary/${movieId}/${theatreId}?orderId=${data.orderId}`);
    } catch (err) {
      setError("Failed to create order. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{movie.title}</h1>
            <p className="text-sm text-muted-foreground">
              {seatMap.screenName} | {date}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (hold) {
                releaseHold();
              }
              setShowTicketModal(true);
            }}
          >
            {ticketCount} Tickets
          </Button>
        </div>
        {hold && timeLeft !== null && (
          <Alert className="mt-4" variant={timeLeft < 60 ? "destructive" : "default"}>
            <AlertTitle>Seats Reserved</AlertTitle>
            <AlertDescription>
              Your seats are held for {formatTime(timeLeft)}. Complete your booking to confirm.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Seat Legend */}
      <div className="mb-6 flex flex-wrap justify-center gap-4">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded border bg-background" />
          <span className="text-sm">Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-green-600" />
          <span className="text-sm">Selected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-muted" />
          <span className="text-sm">Unavailable</span>
        </div>
      </div>

      {/* Screen Indicator */}
      <div className="mb-8 text-center">
        <div className="mx-auto h-2 w-3/4 rounded-t-full bg-gradient-to-b from-muted to-transparent" />
        <p className="mt-1 text-xs text-muted-foreground">Screen this way</p>
      </div>

      {/* Seat Map */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex flex-col items-center gap-2">
            {seatMap.layout.rows.map((row) => (
              <div key={row.rowLabel} className="flex items-center gap-2">
                <span className="w-6 text-center text-sm font-medium text-muted-foreground">
                  {row.rowLabel}
                </span>
                <div className="flex gap-2">
                  {row.seats.map((seat) => {
                    const isUnavailable = unavailableSeats.has(seat);
                    const isSelected = selectedSeats.includes(seat);

                    return (
                      <button
                        key={seat}
                        onClick={() => handleSeatClick(seat)}
                        disabled={isUnavailable || !!hold}
                        className={`flex h-8 w-8 items-center justify-center rounded text-xs font-medium transition-colors ${
                          isUnavailable
                            ? "cursor-not-allowed bg-muted text-muted-foreground"
                            : isSelected
                              ? "bg-green-600 text-white"
                              : "border bg-background hover:border-green-600"
                        }`}
                        title={seat}
                      >
                        {seat.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Price Summary & Action */}
      {selectedSeats.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4 shadow-lg">
          <div className="container mx-auto flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {selectedSeats.length} seat(s) selected
              </p>
              <p className="text-lg font-bold">
                Rs. {seatMap.price * selectedSeats.length}
              </p>
            </div>
            {hold ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={releaseHold}>
                  Cancel
                </Button>
                <Button onClick={() => setShowCustomerModal(true)}>
                  Proceed to Pay
                </Button>
              </div>
            ) : (
              <Button
                onClick={createHold}
                disabled={loading || selectedSeats.length !== ticketCount}
              >
                {loading ? "Reserving..." : "Reserve Seats"}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Ticket Count Modal */}
      <Dialog open={showTicketModal} onOpenChange={setShowTicketModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How many tickets?</DialogTitle>
            <DialogDescription>
              Select the number of tickets you want to book (max 10)
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-5 gap-2 py-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
              <Button
                key={num}
                variant={ticketCount === num ? "default" : "outline"}
                className="h-12 w-12"
                onClick={() => {
                  setTicketCount(num);
                  setSelectedSeats([]);
                }}
              >
                {num}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowTicketModal(false)}>
              Select Seats
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer Details Modal */}
      <Dialog open={showCustomerModal} onOpenChange={setShowCustomerModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter your details</DialogTitle>
            <DialogDescription>
              Please provide your contact information to complete the booking
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="Enter your name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="Enter your email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input
                placeholder="10-digit phone number"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomerModal(false)}>
              Back
            </Button>
            <Button onClick={createOrder} disabled={loading}>
              {loading ? "Creating Order..." : "Continue to Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Spacer for fixed bottom bar */}
      {selectedSeats.length > 0 && <div className="h-24" />}
    </div>
  );
}
