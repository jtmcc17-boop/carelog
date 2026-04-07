from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, JSON
from sqlalchemy.sql import func
from database import Base


class CareCircle(Base):
    __tablename__ = "care_circles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    patient_name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(100), nullable=False)
    role = Column(String(20), nullable=False, default="user")
    relationship = Column(String(100), nullable=True, default="")
    circle_id = Column(Integer, nullable=False, index=True)
    active = Column(Boolean, default=True)
    journal_public = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Entry(Base):
    __tablename__ = "entries"

    id = Column(Integer, primary_key=True, index=True)
    circle_id = Column(Integer, nullable=False, index=True)
    timestamp = Column(String(10), nullable=False)
    reporter = Column(String(100), nullable=False)
    raw_text = Column(Text, nullable=False)
    categories = Column(JSON, default={})
    is_journal = Column(Boolean, nullable=False, default=False)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(Integer, nullable=True)


class Visit(Base):
    __tablename__ = "visits"

    id = Column(Integer, primary_key=True, index=True)
    circle_id = Column(Integer, nullable=False, index=True)
    doctor_name = Column(String(200), nullable=False)
    date = Column(String(10), nullable=False)
    transcript = Column(Text, nullable=False)
    key_takeaways = Column(Text, default="")
    created_by = Column(Integer, nullable=True)
    saved_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(Integer, nullable=True)


class ChangeLog(Base):
    __tablename__ = "changelog"

    id = Column(Integer, primary_key=True, index=True)
    circle_id = Column(Integer, nullable=True, index=True)
    action = Column(String(100), nullable=False)
    details = Column(JSON, default={})
    user_id = Column(Integer, nullable=True)
    username = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
